import { useEffect, useRef, type CSSProperties } from "react";
import { marqueeIcons, MarqueeIcon } from "./MarqueeIcons";

import { useMediaQuery } from "./useMediaQuery";

const MARQUEE_COUNT = marqueeIcons.length;
const MARQUEE_DURATION_S = 36;

function buildMarqueePath(width: number, height: number): string {
  const scaleX = width / 1440;
  const scaleY = height / 120;
  const yOffset = -22;

  return `M ${-80 * scaleX} ${(24 + yOffset) * scaleY} C ${-40 * scaleX} ${(28 + yOffset) * scaleY} ${-20 * scaleX} ${(30 + yOffset) * scaleY} 0 ${(32 + yOffset) * scaleY} C ${320 * scaleX} ${(100 + yOffset) * scaleY} ${720 * scaleX} ${(10 + yOffset) * scaleY} ${1080 * scaleX} ${(80 + yOffset) * scaleY} C ${1260 * scaleX} ${(115 + yOffset) * scaleY} ${1380 * scaleX} ${(60 + yOffset) * scaleY} ${1440 * scaleX} ${(48 + yOffset) * scaleY} C ${1460 * scaleX} ${(46 + yOffset) * scaleY} ${1480 * scaleX} ${(45 + yOffset) * scaleY} ${1520 * scaleX} ${(44 + yOffset) * scaleY}`;
}

export function MarqueeSection() {
  const isMobile = useMediaQuery("(max-width: 900px)");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isMobile) return;
    const el = containerRef.current;
    if (!el) return;

    const updatePath = () => {
      const rect = el.getBoundingClientRect();
      const path = buildMarqueePath(rect.width || 1440, rect.height || 60);
      el.style.setProperty("--marquee-path", `path('${path}')`);
    };

    updatePath();

    const observer = new ResizeObserver(updatePath);
    observer.observe(el);

    return () => observer.disconnect();
  }, [isMobile]);

  if (isMobile) return null;

  return (
    <section className="marquee-section" aria-hidden="true">
      <div className="marquee-curve-container" ref={containerRef}>
        {marqueeIcons.map(({ icon, name }, idx) => (
          <div
            key={name}
            className="marquee-curve-wrapper"
            style={
              {
                "--marquee-delay": `${-(MARQUEE_DURATION_S / MARQUEE_COUNT) * idx}s`,
              } as CSSProperties
            }
          >
            <div className={`marquee-curve-icon ${name}`}>
              <MarqueeIcon icon={icon} size={24} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
