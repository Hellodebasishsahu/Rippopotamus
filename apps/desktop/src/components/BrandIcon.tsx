import { siGoogledrive, siGooglesheets } from "simple-icons";

/** Add slugs here as product surfaces need them — icons come from simple-icons (simpleicons.org). */
const BRANDS = {
  "google-sheets": siGooglesheets,
  "google-drive": siGoogledrive,
} as const;

export type BrandId = keyof typeof BRANDS;

type BrandIconProps = {
  brand: BrandId;
  size?: number;
  className?: string;
  /** When false, uses currentColor (e.g. muted UI chrome). */
  colored?: boolean;
  title?: string;
};

export function BrandIcon({ brand, size = 18, className, colored = true, title }: BrandIconProps) {
  const icon = BRANDS[brand];
  const label = title ?? icon.title;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d={icon.path} fill={colored ? `#${icon.hex}` : "currentColor"} />
    </svg>
  );
}
