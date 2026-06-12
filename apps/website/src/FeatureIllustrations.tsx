type IllustrationProps = {
  className?: string;
};

export function BatchQueueIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 320 200" fill="none" aria-hidden="true">
      <rect width="320" height="200" rx="12" fill="#0d1613" />
      <rect x="20" y="24" width="180" height="152" rx="10" fill="#101a16" stroke="rgba(168,210,188,0.18)" />
      <rect x="36" y="44" width="148" height="28" rx="6" fill="#0a1210" stroke="rgba(168,210,188,0.12)" />
      <rect x="44" y="52" width="72" height="4" rx="2" fill="rgba(127,154,140,0.5)" />
      <rect x="44" y="60" width="48" height="3" rx="1.5" fill="rgba(77,99,88,0.6)" />
      <circle cx="168" cy="58" r="6" fill="#5dffb1" opacity="0.9" />
      <rect x="36" y="80" width="148" height="28" rx="6" fill="#0a1210" stroke="rgba(168,210,188,0.12)" />
      <rect x="44" y="88" width="88" height="4" rx="2" fill="rgba(127,154,140,0.5)" />
      <circle cx="168" cy="94" r="6" fill="#ff6b4a" opacity="0.85" />
      <rect x="36" y="116" width="148" height="28" rx="6" fill="#0a1210" stroke="rgba(168,210,188,0.12)" />
      <rect x="44" y="124" width="64" height="4" rx="2" fill="rgba(127,154,140,0.5)" />
      <circle cx="168" cy="130" r="6" stroke="rgba(168,210,188,0.3)" strokeWidth="2" />
      <rect x="216" y="44" width="84" height="36" rx="8" fill="rgba(255,107,74,0.12)" stroke="rgba(255,107,74,0.35)" />
      <text x="228" y="66" fill="#ff6b4a" fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="600">
        ×4 fetch
      </text>
      <rect x="216" y="92" width="84" height="36" rx="8" fill="rgba(93,255,177,0.1)" stroke="rgba(93,255,177,0.3)" />
      <text x="224" y="114" fill="#5dffb1" fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="600">
        ×2 save
      </text>
      <path d="M196 58h16M196 94h16" stroke="rgba(168,210,188,0.25)" strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  );
}

export function PreviewIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 320 200" fill="none" aria-hidden="true">
      <rect width="320" height="200" rx="12" fill="#0d1613" />
      <rect x="28" y="32" width="112" height="72" rx="8" fill="#101a16" stroke="rgba(168,210,188,0.2)" />
      <rect x="36" y="40" width="96" height="48" rx="4" fill="#1a2822" />
      <circle cx="84" cy="64" r="14" fill="rgba(255,107,74,0.85)" />
      <path d="M80 58l10 6-10 6V58z" fill="#0a1210" />
      <rect x="28" y="112" width="112" height="8" rx="3" fill="rgba(230,239,233,0.7)" />
      <rect x="28" y="126" width="72" height="6" rx="3" fill="rgba(127,154,140,0.45)" />
      <rect x="156" y="32" width="136" height="136" rx="10" fill="#101a16" stroke="rgba(168,210,188,0.15)" />
      <rect x="172" y="48" width="56" height="6" rx="3" fill="#5dffb1" opacity="0.8" />
      <rect x="172" y="62" width="88" height="5" rx="2.5" fill="rgba(127,154,140,0.5)" />
      <rect x="172" y="74" width="64" height="5" rx="2.5" fill="rgba(77,99,88,0.55)" />
      <rect x="172" y="96" width="40" height="18" rx="9" fill="rgba(93,255,177,0.12)" stroke="rgba(93,255,177,0.35)" />
      <text x="182" y="109" fill="#5dffb1" fontFamily="ui-monospace, monospace" fontSize="8">
        12:04
      </text>
      <rect x="220" y="96" width="52" height="18" rx="9" fill="rgba(255,107,74,0.1)" stroke="rgba(255,107,74,0.3)" />
      <text x="230" y="109" fill="#ff6b4a" fontFamily="ui-monospace, monospace" fontSize="8">
        youtube
      </text>
      <rect x="172" y="128" width="104" height="24" rx="6" fill="#0a1210" stroke="rgba(168,210,188,0.12)" />
      <text x="184" y="144" fill="rgba(127,154,140,0.8)" fontFamily="ui-monospace, monospace" fontSize="8">
        ready to save
      </text>
    </svg>
  );
}

export function PresetsIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 320 200" fill="none" aria-hidden="true">
      <rect width="320" height="200" rx="12" fill="#0d1613" />
      <rect x="32" y="36" width="256" height="128" rx="12" fill="#101a16" stroke="rgba(168,210,188,0.15)" />
      <rect x="48" y="56" width="52" height="28" rx="14" fill="rgba(255,107,74,0.18)" stroke="#ff6b4a" strokeWidth="1.5" />
      <text x="62" y="74" fill="#ff6b4a" fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="600">
        MP4
      </text>
      <rect x="112" y="56" width="52" height="28" rx="14" fill="rgba(93,255,177,0.12)" stroke="rgba(93,255,177,0.45)" />
      <text x="126" y="74" fill="#5dffb1" fontFamily="ui-monospace, monospace" fontSize="10" fontWeight="600">
        MP3
      </text>
      <rect x="176" y="56" width="60" height="28" rx="14" fill="#0a1210" stroke="rgba(168,210,188,0.2)" />
      <text x="186" y="74" fill="rgba(230,239,233,0.7)" fontFamily="ui-monospace, monospace" fontSize="10">
        720p
      </text>
      <rect x="248" y="56" width="24" height="28" rx="14" fill="#0a1210" stroke="rgba(168,210,188,0.2)" />
      <rect x="48" y="104" width="224" height="8" rx="4" fill="rgba(168,210,188,0.1)" />
      <rect x="48" y="104" width="148" height="8" rx="4" fill="linear-gradient" />
      <rect x="48" y="104" width="148" height="8" rx="4" fill="url(#presetGrad)" />
      <circle cx="196" cy="108" r="10" fill="#ff6b4a" stroke="#0a1210" strokeWidth="3" />
      <rect x="48" y="128" width="88" height="20" rx="6" fill="rgba(93,255,177,0.08)" stroke="rgba(93,255,177,0.25)" />
      <text x="58" y="142" fill="#5dffb1" fontFamily="ui-monospace, monospace" fontSize="8">
        thumb only
      </text>
      <rect x="148" y="128" width="72" height="20" rx="6" fill="rgba(255,107,74,0.08)" stroke="rgba(255,107,74,0.25)" />
      <text x="158" y="142" fill="#ff6b4a" fontFamily="ui-monospace, monospace" fontSize="8">
        magnet
      </text>
      <defs>
        <linearGradient id="presetGrad" x1="48" y1="108" x2="196" y2="108" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5dffb1" />
          <stop offset="1" stopColor="#ff6b4a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function SniffIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 320 200" fill="none" aria-hidden="true">
      <rect width="320" height="200" rx="12" fill="#0d1613" />
      <rect x="24" y="28" width="272" height="144" rx="10" fill="#101a16" stroke="rgba(168,210,188,0.18)" />
      <rect x="24" y="28" width="272" height="24" rx="10" fill="#0a1210" />
      <circle cx="44" cy="40" r="4" fill="#ff6b4a" opacity="0.7" />
      <circle cx="58" cy="40" r="4" fill="rgba(127,154,140,0.4)" />
      <circle cx="72" cy="40" r="4" fill="rgba(127,154,140,0.4)" />
      <rect x="40" y="68" width="120" height="8" rx="3" fill="rgba(127,154,140,0.35)" />
      <rect x="40" y="84" width="88" height="6" rx="3" fill="rgba(77,99,88,0.5)" />
      <rect x="40" y="100" width="96" height="40" rx="6" fill="#1a2822" stroke="rgba(168,210,188,0.12)" />
      <circle cx="88" cy="120" r="12" fill="rgba(255,107,74,0.9)" />
      <path d="M84 114l8 6-8 6v-12z" fill="#0a1210" />
      <circle cx="200" cy="108" r="36" fill="rgba(93,255,177,0.06)" stroke="rgba(93,255,177,0.35)" strokeWidth="1.5" strokeDasharray="4 4" />
      <circle cx="200" cy="108" r="22" fill="none" stroke="#5dffb1" strokeWidth="2" opacity="0.6" />
      <path d="M218 126l18 18" stroke="#5dffb1" strokeWidth="3" strokeLinecap="round" />
      <circle cx="236" cy="144" r="6" fill="#5dffb1" opacity="0.8" />
      <rect x="176" y="148" width="96" height="16" rx="8" fill="rgba(93,255,177,0.12)" stroke="rgba(93,255,177,0.35)" />
      <text x="188" y="160" fill="#5dffb1" fontFamily="ui-monospace, monospace" fontSize="8" fontWeight="600">
        12 found
      </text>
    </svg>
  );
}

export function LocalSaveIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 320 200" fill="none" aria-hidden="true">
      <rect width="320" height="200" rx="12" fill="#0d1613" />
      <path d="M48 56h72l16 16h120v88H48V56z" fill="#101a16" stroke="rgba(168,210,188,0.2)" strokeLinejoin="round" />
      <path d="M72 96h176M72 116h140M72 136h96" stroke="rgba(168,210,188,0.15)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="180" y="32" width="108" height="136" rx="10" fill="#0a1210" stroke="rgba(168,210,188,0.15)" />
      <text x="196" y="56" fill="#5dffb1" fontFamily="ui-monospace, monospace" fontSize="9" fontWeight="600">
        ~/Downloads/Rippo
      </text>
      <rect x="196" y="68" width="76" height="18" rx="4" fill="rgba(93,255,177,0.08)" />
      <text x="204" y="81" fill="rgba(230,239,233,0.75)" fontFamily="ui-monospace, monospace" fontSize="8">
        Source/
      </text>
      <rect x="196" y="92" width="76" height="18" rx="4" fill="rgba(255,107,74,0.08)" />
      <text x="204" y="105" fill="rgba(230,239,233,0.75)" fontFamily="ui-monospace, monospace" fontSize="8">
        Audio/
      </text>
      <rect x="196" y="116" width="76" height="18" rx="4" fill="rgba(168,210,188,0.06)" />
      <text x="204" y="129" fill="rgba(230,239,233,0.75)" fontFamily="ui-monospace, monospace" fontSize="8">
        Images/
      </text>
      <circle cx="148" cy="148" r="14" fill="rgba(93,255,177,0.15)" stroke="#5dffb1" strokeWidth="1.5" />
      <path d="M142 148l4 4 8-8" stroke="#5dffb1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="108" y="178" fill="rgba(127,154,140,0.7)" fontFamily="ui-monospace, monospace" fontSize="8">
        skip dupes
      </text>
    </svg>
  );
}

export function AccessIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 320 200" fill="none" aria-hidden="true">
      <rect width="320" height="200" rx="12" fill="#0d1613" />
      <rect x="40" y="48" width="88" height="104" rx="12" fill="#101a16" stroke="rgba(168,210,188,0.15)" />
      <ellipse cx="84" cy="88" rx="24" ry="20" fill="rgba(255,107,74,0.12)" stroke="rgba(255,107,74,0.4)" />
      <circle cx="76" cy="84" r="4" fill="#ff6b4a" />
      <circle cx="92" cy="84" r="4" fill="#ff6b4a" />
      <path d="M72 96c4 6 20 6 24 0" stroke="#ff6b4a" strokeWidth="1.5" strokeLinecap="round" />
      <text x="58" y="132" fill="rgba(127,154,140,0.8)" fontFamily="ui-monospace, monospace" fontSize="8">
        cookies
      </text>
      <rect x="148" y="64" width="124" height="16" rx="8" fill="rgba(93,255,177,0.1)" stroke="rgba(93,255,177,0.3)" />
      <circle cx="160" cy="72" r="5" fill="#5dffb1" />
      <rect x="172" y="69" width="48" height="6" rx="3" fill="rgba(127,154,140,0.4)" />
      <path d="M148 120c40-24 80-24 124 0" stroke="rgba(93,255,177,0.35)" strokeWidth="2" strokeDasharray="6 4" />
      <text x="188" y="108" fill="#5dffb1" fontFamily="ui-monospace, monospace" fontSize="8">
        proxy
      </text>
      <rect x="148" y="136" width="124" height="40" rx="10" fill="rgba(255,107,74,0.08)" stroke="rgba(255,107,74,0.3)" />
      <rect x="164" y="148" width="20" height="16" rx="4" fill="none" stroke="#ff6b4a" strokeWidth="1.5" />
      <path d="M172 156v4" stroke="#ff6b4a" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="172" cy="152" r="2" fill="#ff6b4a" />
      <text x="192" y="162" fill="#ff6b4a" fontFamily="ui-monospace, monospace" fontSize="9" fontWeight="600">
        private mode
      </text>
    </svg>
  );
}

export const featureIllustrations = {
  batch: BatchQueueIllustration,
  preview: PreviewIllustration,
  presets: PresetsIllustration,
  sniff: SniffIllustration,
  local: LocalSaveIllustration,
  access: AccessIllustration,
} as const;