# Walkthrough - Word-Level Timestamps

I have modified the codebase to enable word-level timestamps (tokens) in the transcription logs, replacing the segment-level timestamps.

## Changes

### 1. Native iOS Module (`ios/RNWhisperContext.mm`)

I updated the `getTextSegments` method to extract token information from the `whisper.cpp` context and include it in the result dictionary passed to JavaScript.

```objectivec
// ios/RNWhisperContext.mm

// ... inside getTextSegments loop ...
NSMutableArray *tokens = [[NSMutableArray alloc] init];
int n_tokens = whisper_full_n_tokens(self->ctx, i);
for (int j = 0; j < n_tokens; j++) {
    whisper_token_data data = whisper_full_get_token_data(self->ctx, i, j);
    const char * token_text = whisper_full_get_token_text(self->ctx, i, j);
    [tokens addObject:@{
        @"text": [NSString stringWithUTF8String:token_text],
        @"t0": [NSNumber numberWithLongLong:data.t0],
        @"t1": [NSNumber numberWithLongLong:data.t1],
        @"p": [NSNumber numberWithFloat:data.p]
    }];
}

NSDictionary *segment = @{
    @"text": [NSString stringWithString:mutable_ns_text],
    @"t0": [NSNumber numberWithLongLong:t0],
    @"t1": [NSNumber numberWithLongLong:t1],
    @"tokens": tokens // Added tokens
};
```

### 2. Example App (`example/src/InboxWatcher.tsx`)

I updated the `InboxWatcher` component to:
1.  Enable `tokenTimestamps: true` in the transcription options.
2.  Iterate over the `tokens` array within each segment and log them individually.
3.  Render the token logs in the UI.

```typescript
// example/src/InboxWatcher.tsx

// Enable token timestamps
const { promise } = ctx.transcribe(filePath, {
  // ...
  tokenTimestamps: true,
})

// Log tokens
segments.forEach((segment) => {
  const tokens = (segment as any)?.tokens?.map(/* ... */) ?? []
  tokens.forEach((token) => {
    pushLog({
      kind: 'token',
      start: token.start,
      end: token.end,
      text: token.text,
    })
  })
})
```

## Verification

Since I cannot run the iOS simulator directly, I have verified the code changes by:
1.  Confirming that `whisper.cpp` API supports extracting token data (`whisper_full_n_tokens`, `whisper_full_get_token_data`).
2.  Ensuring the `InboxWatcher.tsx` logic expects `tokens` in the segment object and logs them if present.
3.  Verifying that `tokenTimestamps: true` is passed in the transcription options.

You should now see logs like:
`[Watcher] token 00:00:00,000 -> 00:00:00,500: Hello`
instead of segment logs.
