"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { useSpeech } from "@/lib/useSpeech";
import { IconMic } from "./icons";

export interface MicState {
  listening: boolean;
  interim: string;
}

/**
 * Self-contained dictation button (Web Speech API, no keys).
 * Renders nothing when the browser doesn't support speech recognition.
 */
export default function MicButton({
  onFinal,
  onState,
  size = 10,
}: {
  onFinal: (text: string) => void;
  onState?: (state: MicState) => void;
  size?: 9 | 10;
}) {
  const { supported, listening, interim, toggle } = useSpeech(onFinal);

  useEffect(() => {
    onState?.({ listening, interim });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onState identity is not load-bearing
  }, [listening, interim]);

  if (!supported) return null;

  const dim = size === 9 ? "h-9 w-9" : "h-10 w-10";
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={toggle}
      aria-label={listening ? "Stop dictation" : "Dictate with microphone"}
      aria-pressed={listening}
      title={listening ? "Stop dictation" : "Speak instead of typing (browser speech recognition)"}
      className={`flex ${dim} shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors ${
        listening ? "mic-live bg-neon-rose text-white" : "text-ink-dim hover:bg-white/[0.06] hover:text-ink"
      }`}
    >
      <IconMic />
    </motion.button>
  );
}
