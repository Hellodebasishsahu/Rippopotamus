type IconProps = {
  className?: string;
};

const stroke = {
  round: { strokeLinecap: "round" as const, strokeLinejoin: "round" as const },
};

function IconFrame({ className, children, accent }: IconProps & { accent: "coral" | "mint"; children: React.ReactNode }) {
  const glow = accent === "coral" ? "rgba(255,107,74,0.14)" : "rgba(93,255,177,0.12)";
  const ring = accent === "coral" ? "rgba(255,107,74,0.35)" : "rgba(93,255,177,0.32)";

  return (
    <svg
      className={className}
      viewBox="0 0 96 96"
      fill="none"
      aria-hidden="true"
      shapeRendering="geometricPrecision"
    >
      <circle cx="48" cy="48" r="40" fill={glow} />
      <circle cx="48" cy="48" r="40" stroke={ring} strokeWidth="1.5" opacity="0.7" />
      {children}
    </svg>
  );
}

export function BatchQueueIllustration({ className }: IconProps) {
  return (
    <IconFrame className={className} accent="coral">
      <rect x="26" y="30" width="44" height="10" rx="3" stroke="#e6efe9" strokeWidth="2.5" opacity="0.35" {...stroke.round} />
      <rect x="26" y="44" width="44" height="10" rx="3" stroke="#e6efe9" strokeWidth="2.5" opacity="0.55" {...stroke.round} />
      <rect x="26" y="58" width="44" height="10" rx="3" stroke="#ff6b4a" strokeWidth="2.5" {...stroke.round} />
      <path d="M74 35h10M74 49h10M74 63h10" stroke="#5dffb1" strokeWidth="2.5" {...stroke.round} />
      <circle cx="68" cy="35" r="3" fill="#5dffb1" />
      <circle cx="68" cy="49" r="3" fill="#ff6b4a" />
      <circle cx="68" cy="63" r="3" fill="#5dffb1" />
    </IconFrame>
  );
}

export function PreviewIllustration({ className }: IconProps) {
  return (
    <IconFrame className={className} accent="mint">
      <rect x="24" y="28" width="48" height="36" rx="6" stroke="#e6efe9" strokeWidth="2.5" {...stroke.round} />
      <path d="M42 40l14 8-14 8V40z" fill="#ff6b4a" />
      <path d="M24 68h48" stroke="#5dffb1" strokeWidth="2.5" {...stroke.round} />
      <circle cx="34" cy="68" r="3" fill="#5dffb1" />
      <circle cx="48" cy="68" r="3" fill="#e6efe9" opacity="0.4" />
    </IconFrame>
  );
}

export function PresetsIllustration({ className }: IconProps) {
  return (
    <IconFrame className={className} accent="mint">
      <path d="M22 36h52" stroke="#e6efe9" strokeWidth="2.5" opacity="0.35" {...stroke.round} />
      <circle cx="38" cy="36" r="6" fill="#5dffb1" stroke="#0a1210" strokeWidth="2" />
      <path d="M22 48h52" stroke="#e6efe9" strokeWidth="2.5" opacity="0.55" {...stroke.round} />
      <circle cx="58" cy="48" r="6" fill="#ff6b4a" stroke="#0a1210" strokeWidth="2" />
      <path d="M22 60h52" stroke="#e6efe9" strokeWidth="2.5" {...stroke.round} />
      <circle cx="44" cy="60" r="6" fill="#e6efe9" stroke="#0a1210" strokeWidth="2" />
    </IconFrame>
  );
}

export function SniffIllustration({ className }: IconProps) {
  return (
    <IconFrame className={className} accent="coral">
      <rect x="22" y="30" width="36" height="28" rx="5" stroke="#e6efe9" strokeWidth="2.5" opacity="0.45" {...stroke.round} />
      <circle cx="40" cy="44" r="8" fill="#ff6b4a" />
      <path d="M37 41l6 4-6 4V41z" fill="#0a1210" />
      <circle cx="62" cy="56" r="14" stroke="#5dffb1" strokeWidth="2.5" {...stroke.round} />
      <path d="M72 66l12 12" stroke="#5dffb1" strokeWidth="3" {...stroke.round} />
      <circle cx="84" cy="78" r="4" fill="#5dffb1" />
    </IconFrame>
  );
}

export function LocalSaveIllustration({ className }: IconProps) {
  return (
    <IconFrame className={className} accent="mint">
      <path
        d="M24 34h28l8 10h24v30H24V34z"
        stroke="#e6efe9"
        strokeWidth="2.5"
        {...stroke.round}
      />
      <path d="M48 52v18M42 64l6 6 6-6" stroke="#5dffb1" strokeWidth="2.5" {...stroke.round} />
      <circle cx="68" cy="62" r="10" fill="rgba(93,255,177,0.15)" stroke="#5dffb1" strokeWidth="2" />
      <path d="M64 62l3 3 7-7" stroke="#5dffb1" strokeWidth="2.5" {...stroke.round} />
    </IconFrame>
  );
}

export function AccessIllustration({ className }: IconProps) {
  return (
    <IconFrame className={className} accent="coral">
      <path
        d="M48 24c-8 0-14 6-14 14v6h28v-6c0-8-6-14-14-14z"
        stroke="#ff6b4a"
        strokeWidth="2.5"
        {...stroke.round}
      />
      <rect x="30" y="44" width="36" height="28" rx="6" stroke="#e6efe9" strokeWidth="2.5" {...stroke.round} />
      <circle cx="40" cy="58" r="3" fill="#ff6b4a" />
      <circle cx="48" cy="58" r="3" fill="#ff6b4a" />
      <circle cx="56" cy="58" r="3" fill="#ff6b4a" />
      <path d="M48 66v6" stroke="#5dffb1" strokeWidth="2.5" {...stroke.round} />
      <circle cx="48" cy="74" r="2.5" fill="#5dffb1" />
    </IconFrame>
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