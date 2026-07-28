#import <AppKit/AppKit.h>
#import <AudioToolbox/AudioToolbox.h>
#import <CoreAudio/CoreAudio.h>
#import <Foundation/Foundation.h>

static void printJSON(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  fwrite(data.bytes, 1, data.length, stdout);
  fputc('\n', stdout);
}

static NSString *stringProperty(
  AudioObjectID object,
  AudioObjectPropertySelector selector
) {
  AudioObjectPropertyAddress address = {
    selector,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain,
  };
  CFStringRef value = NULL;
  UInt32 size = sizeof(value);
  if (
    AudioObjectGetPropertyData(object, &address, 0, NULL, &size, &value) != noErr ||
    value == NULL
  ) return @"";
  return CFBridgingRelease(value);
}

static BOOL hasStreams(AudioDeviceID device, AudioObjectPropertyScope scope) {
  AudioObjectPropertyAddress address = {
    kAudioDevicePropertyStreams,
    scope,
    kAudioObjectPropertyElementMain,
  };
  UInt32 size = 0;
  return AudioObjectGetPropertyDataSize(device, &address, 0, NULL, &size) == noErr &&
    size >= sizeof(AudioStreamID);
}

static AudioDeviceID defaultDevice(AudioObjectPropertySelector selector) {
  AudioObjectPropertyAddress address = {
    selector,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain,
  };
  AudioDeviceID value = kAudioObjectUnknown;
  UInt32 size = sizeof(value);
  AudioObjectGetPropertyData(
    kAudioObjectSystemObject,
    &address,
    0,
    NULL,
    &size,
    &value
  );
  return value;
}

static BOOL scalarProperty(
  AudioDeviceID device,
  AudioObjectPropertySelector selector,
  AudioObjectPropertyScope scope,
  Float32 *value
) {
  AudioObjectPropertyAddress address = {
    selector,
    scope,
    kAudioObjectPropertyElementMain,
  };
  UInt32 size = sizeof(*value);
  return AudioObjectGetPropertyData(device, &address, 0, NULL, &size, value) == noErr;
}

static BOOL setScalarProperty(
  AudioDeviceID device,
  AudioObjectPropertySelector selector,
  AudioObjectPropertyScope scope,
  Float32 value
) {
  AudioObjectPropertyAddress address = {
    selector,
    scope,
    kAudioObjectPropertyElementMain,
  };
  Boolean settable = false;
  if (!AudioObjectHasProperty(device, &address) ||
      AudioObjectIsPropertySettable(device, &address, &settable) != noErr ||
      !settable) return NO;
  UInt32 size = sizeof(value);
  return AudioObjectSetPropertyData(device, &address, 0, NULL, size, &value) == noErr;
}

static NSArray *audioDevices(void) {
  AudioObjectPropertyAddress address = {
    kAudioHardwarePropertyDevices,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain,
  };
  UInt32 size = 0;
  if (
    AudioObjectGetPropertyDataSize(
      kAudioObjectSystemObject,
      &address,
      0,
      NULL,
      &size
    ) != noErr
  ) return @[];
  NSUInteger count = size / sizeof(AudioDeviceID);
  AudioDeviceID *ids = calloc(count, sizeof(AudioDeviceID));
  if (
    AudioObjectGetPropertyData(
      kAudioObjectSystemObject,
      &address,
      0,
      NULL,
      &size,
      ids
    ) != noErr
  ) {
    free(ids);
    return @[];
  }

  AudioDeviceID defaultInput = defaultDevice(kAudioHardwarePropertyDefaultInputDevice);
  AudioDeviceID defaultOutput = defaultDevice(kAudioHardwarePropertyDefaultOutputDevice);
  NSMutableArray *result = [NSMutableArray array];
  for (NSUInteger index = 0; index < count; index++) {
    AudioDeviceID device = ids[index];
    NSString *uid = stringProperty(device, kAudioDevicePropertyDeviceUID);
    NSString *name = stringProperty(device, kAudioObjectPropertyName);
    if (!uid.length || !name.length) continue;
    BOOL input = hasStreams(device, kAudioDevicePropertyScopeInput);
    BOOL output = hasStreams(device, kAudioDevicePropertyScopeOutput);
    if (!input && !output) continue;
    [result addObject:@{
      @"uid": uid,
      @"name": name,
      @"input": @(input),
      @"output": @(output),
      @"defaultInput": @((BOOL)(device == defaultInput)),
      @"defaultOutput": @((BOOL)(device == defaultOutput)),
    }];
  }
  free(ids);
  return result;
}

static NSDictionary *audioStatus(void) {
  AudioDeviceID input = defaultDevice(kAudioHardwarePropertyDefaultInputDevice);
  Float32 mute = 0;
  Float32 volume = 1;
  BOOL hasMute = scalarProperty(
    input,
    kAudioDevicePropertyMute,
    kAudioDevicePropertyScopeInput,
    &mute
  );
  BOOL hasVolume = scalarProperty(
    input,
    kAudioDevicePropertyVolumeScalar,
    kAudioDevicePropertyScopeInput,
    &volume
  );
  return @{
    @"devices": audioDevices(),
    @"micMuted": @((BOOL)(
      (hasMute && mute >= 0.5) || (hasVolume && volume <= 0.001)
    )),
    @"inputVolume": @(hasVolume ? volume : 1),
    @"canMuteInput": @((BOOL)(hasMute || hasVolume)),
  };
}

static AudioDeviceID deviceForUID(NSString *uid) {
  for (NSDictionary *device in audioDevices()) {
    if (![device[@"uid"] isEqualToString:uid]) continue;
    AudioObjectPropertyAddress address = {
      kAudioHardwarePropertyDevices,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain,
    };
    UInt32 size = 0;
    AudioObjectGetPropertyDataSize(
      kAudioObjectSystemObject,
      &address,
      0,
      NULL,
      &size
    );
    NSUInteger count = size / sizeof(AudioDeviceID);
    AudioDeviceID *ids = calloc(count, sizeof(AudioDeviceID));
    AudioObjectGetPropertyData(
      kAudioObjectSystemObject,
      &address,
      0,
      NULL,
      &size,
      ids
    );
    AudioDeviceID found = kAudioObjectUnknown;
    for (NSUInteger index = 0; index < count; index++) {
      if ([stringProperty(ids[index], kAudioDevicePropertyDeviceUID) isEqualToString:uid]) {
        found = ids[index];
        break;
      }
    }
    free(ids);
    return found;
  }
  return kAudioObjectUnknown;
}

static BOOL setDefaultDevice(
  NSString *uid,
  AudioObjectPropertySelector selector
) {
  AudioDeviceID device = deviceForUID(uid);
  if (device == kAudioObjectUnknown) return NO;
  AudioObjectPropertyAddress address = {
    selector,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain,
  };
  UInt32 size = sizeof(device);
  return AudioObjectSetPropertyData(
    kAudioObjectSystemObject,
    &address,
    0,
    NULL,
    size,
    &device
  ) == noErr;
}

static BOOL setInputMuted(BOOL muted, Float32 restoreVolume) {
  AudioDeviceID input = defaultDevice(kAudioHardwarePropertyDefaultInputDevice);
  Float32 mute = muted ? 1 : 0;
  BOOL wroteMute = setScalarProperty(
    input,
    kAudioDevicePropertyMute,
    kAudioDevicePropertyScopeInput,
    mute
  );
  Float32 observedMute = 0;
  BOOL muteMatches = wroteMute && scalarProperty(
    input,
    kAudioDevicePropertyMute,
    kAudioDevicePropertyScopeInput,
    &observedMute
  ) && ((observedMute >= 0.5) == muted);
  Float32 observedVolume = 1;
  BOOL hasVolume = scalarProperty(
    input,
    kAudioDevicePropertyVolumeScalar,
    kAudioDevicePropertyScopeInput,
    &observedVolume
  );
  if (muteMatches && (muted || !hasVolume || observedVolume > 0.001)) {
    return YES;
  }

  BOOL wroteVolume = setScalarProperty(
    input,
    kAudioDevicePropertyVolumeScalar,
    kAudioDevicePropertyScopeInput,
    muted ? 0 : fmaxf(0.05, fminf(1, restoreVolume))
  );
  if (!wroteVolume || !scalarProperty(
    input,
    kAudioDevicePropertyVolumeScalar,
    kAudioDevicePropertyScopeInput,
    &observedVolume
  )) return NO;
  return muted ? observedVolume <= 0.001 : observedVolume > 0.001;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      printJSON(@{@"ok": @NO, @"error": @"Missing command"});
      return 2;
    }
    NSString *command = [NSString stringWithUTF8String:argv[1]];
    if ([command isEqualToString:@"status"]) {
      printJSON(@{@"ok": @YES, @"audio": audioStatus()});
      return 0;
    }
    if ([command isEqualToString:@"set-output"] && argc >= 3) {
      NSString *uid = [NSString stringWithUTF8String:argv[2]];
      BOOL output = setDefaultDevice(uid, kAudioHardwarePropertyDefaultOutputDevice);
      BOOL system = setDefaultDevice(uid, kAudioHardwarePropertyDefaultSystemOutputDevice);
      printJSON(@{@"ok": @(output), @"systemOutput": @(system)});
      return output ? 0 : 1;
    }
    if ([command isEqualToString:@"set-input"] && argc >= 3) {
      NSString *uid = [NSString stringWithUTF8String:argv[2]];
      BOOL ok = setDefaultDevice(uid, kAudioHardwarePropertyDefaultInputDevice);
      printJSON(@{@"ok": @(ok)});
      return ok ? 0 : 1;
    }
    if ([command isEqualToString:@"set-mic-muted"] && argc >= 3) {
      BOOL muted = strcmp(argv[2], "true") == 0;
      Float32 restoreVolume = argc >= 4 ? strtof(argv[3], NULL) : 0.75;
      BOOL ok = setInputMuted(muted, restoreVolume);
      printJSON(@{@"ok": @(ok), @"muted": @(muted)});
      return ok ? 0 : 1;
    }
    printJSON(@{@"ok": @NO, @"error": @"Unknown command"});
    return 2;
  }
}
