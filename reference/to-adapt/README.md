# Copied from TigoGrow, not adapted yet

These four are the talking-face and voice half of the engine. They are out of
`src/` on purpose: each still imports something this project does not have, so
they would break the build where they stand.

| file | what it still needs |
|---|---|
| `ask-jessy.tsx` | drops `next-intl` (the site is Arabic only) and `lucide-react`; its strings become Arabic literals |
| `jessy-face.tsx` | works as is once the shader landmarks are tuned against the running page |
| `use-speech.ts`  | drops `lib/talk/clips` — that is Tigo's recorded voice, which Jessy has none of; browser Arabic TTS only |
| `open-chat.tsx`  | only needed if the chat is opened from another page |

The shader itself (`src/lib/talk/face-shader.ts`) is already measured for
Jessy's portrait and is in `src/`.
