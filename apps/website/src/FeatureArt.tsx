type Motif = "lilypads" | "bloom" | "reeds" | "ripples" | "stream" | "lotus";

type FeatureArtProps = {
  motif: Motif;
  accent: "coral" | "mint";
};

const stem = "#3d6b58";
const leaf = "#2f5f4a";
const leafLight = "#4a8f6e";

function FeatureArt({ motif, accent }: FeatureArtProps) {
  const hot = accent === "coral" ? "#ff6b4a" : "#5dffb1";
  const hotSoft = accent === "coral" ? "#c94f35" : "#3fbf82";
  const petal = accent === "coral" ? "#ff8a70" : "#7dffc4";

  switch (motif) {
    case "lilypads":
      return (
        <svg className="feature-illo" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="lily-water-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#080f0d" />
              <stop offset="100%" stopColor="#0e1714" />
            </linearGradient>
            <linearGradient id="lily-pad-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={leafLight} />
              <stop offset="100%" stopColor={leaf} />
            </linearGradient>
            <linearGradient id="lily-pad-grad-2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={stem} />
              <stop offset="100%" stopColor={leaf} />
            </linearGradient>
            <linearGradient id="lily-pad-grad-3" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={leafLight} />
              <stop offset="100%" stopColor={stem} />
            </linearGradient>
            <linearGradient id="lily-accent-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={petal} />
              <stop offset="100%" stopColor={hot} />
            </linearGradient>
          </defs>

          {/* Water Background */}
          <rect width="200" height="160" fill="url(#lily-water-grad)" />

          {/* Subtle Blueprint Diagonals */}
          <line x1="-20" y1="-20" x2="220" y2="220" stroke={stem} strokeWidth="1" opacity="0.05" />
          <line x1="220" y1="-20" x2="-20" y2="220" stroke={stem} strokeWidth="1" opacity="0.05" />

          {/* Architectural Construction Grid */}
          <g opacity="0.15">
            {/* Verticals */}
            <line x1="60" y1="0" x2="60" y2="160" stroke={stem} strokeWidth="1" strokeDasharray="4 4" />
            <line x1="105" y1="0" x2="105" y2="160" stroke={stem} strokeWidth="1" strokeDasharray="4 4" />
            <line x1="135" y1="0" x2="135" y2="160" stroke={stem} strokeWidth="1" strokeDasharray="4 4" />
            
            {/* Horizontals */}
            <line x1="0" y1="65" x2="200" y2="65" stroke={stem} strokeWidth="1" strokeDasharray="4 4" />
            <line x1="0" y1="95" x2="200" y2="95" stroke={stem} strokeWidth="1" strokeDasharray="4 4" />
            <line x1="0" y1="125" x2="200" y2="125" stroke={stem} strokeWidth="1" strokeDasharray="4 4" />
            
            {/* Crosshair nodes at key intersections */}
            <circle cx="105" cy="65" r="2" fill={hotSoft} />
            <circle cx="60" cy="125" r="2" fill={leafLight} />
            <circle cx="135" cy="95" r="2" fill={leafLight} />
            <circle cx="135" cy="125" r="2" fill={leafLight} />
            <circle cx="60" cy="65" r="2" fill={leafLight} />
          </g>

          {/* Pad 1 (Large, Center 60,95) & Outer Ring */}
          <g opacity="0.6">
            <circle cx="60" cy="95" r="42" fill="none" stroke={leafLight} strokeWidth="0.5" strokeDasharray="1 3" />
            <line x1="60" y1="53" x2="60" y2="49" stroke={hotSoft} strokeWidth="1" />
            <line x1="60" y1="137" x2="60" y2="141" stroke={hotSoft} strokeWidth="1" />
            <line x1="18" y1="95" x2="14" y2="95" stroke={hotSoft} strokeWidth="1" />
            <line x1="102" y1="95" x2="106" y2="95" stroke={hotSoft} strokeWidth="1" />
          </g>
          <path d="M 60 95 L 94.77 104.31 A 36 36 0 1 1 94.77 85.68 Z" fill="url(#lily-pad-grad-1)" stroke={leafLight} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M 85.11 101.73 A 26 26 0 1 1 85.11 88.27" fill="none" stroke={leafLight} strokeWidth="1" opacity="0.6" />
          <path d="M 75.45 99.14 A 16 16 0 1 1 75.45 90.86" fill="none" stroke={leafLight} strokeWidth="1" opacity="0.4" />

          {/* Pad 3 (Small, Center 105,125) & Outer Ring */}
          <circle cx="105" cy="125" r="20" fill="none" stroke={stem} strokeWidth="0.5" strokeDasharray="1 2" opacity="0.6" />
          <path d="M 105 125 L 91.144 133 A 16 16 0 1 1 97 138.856 Z" fill="url(#lily-pad-grad-3)" stroke={stem} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M 98.072 129 A 8 8 0 1 1 101 131.928" fill="none" stroke={stem} strokeWidth="1" opacity="0.6" />
          
          {/* Bud on Pad 3 */}
          <g className="art-lily-bud">
            <polygon points="105,117 109,125 105,133 101,125" fill="url(#lily-accent-grad)" opacity="0.9" />
            <polygon points="105,117 109,125 105,133 101,125" fill="url(#lily-accent-grad)" opacity="0.7" transform="rotate(90 105 125)" />
            <circle cx="105" cy="125" r="1.5" fill="#080f0d" />
          </g>

          {/* Pad 2 (Medium, Center 135,65) & Outer Ring */}
          <g opacity="0.5">
            <circle cx="135" cy="65" r="30" fill="none" stroke={petal} strokeWidth="0.5" strokeDasharray="2 4" />
            <line x1="135" y1="35" x2="135" y2="32" stroke={petal} strokeWidth="1" />
            <line x1="135" y1="95" x2="135" y2="98" stroke={petal} strokeWidth="1" />
            <line x1="105" y1="65" x2="102" y2="65" stroke={petal} strokeWidth="1" />
            <line x1="165" y1="65" x2="168" y2="65" stroke={petal} strokeWidth="1" />
          </g>
          <path d="M 135 65 L 123 44.216 A 24 24 0 1 1 114.216 53 Z" fill="url(#lily-pad-grad-2)" stroke={hotSoft} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M 128 52.876 A 14 14 0 1 1 122.876 58" fill="none" stroke={hotSoft} strokeWidth="1" opacity="0.6" />

          {/* Flower on Pad 2 */}
          <g className="art-lily-flower">
            <polygon points="135,53 141,65 135,77 129,65" fill="url(#lily-accent-grad)" opacity="0.9" />
            <polygon points="135,53 141,65 135,77 129,65" fill="url(#lily-accent-grad)" opacity="0.8" transform="rotate(45 135 65)" />
            <polygon points="135,53 141,65 135,77 129,65" fill="url(#lily-accent-grad)" opacity="0.7" transform="rotate(90 135 65)" />
            <polygon points="135,53 141,65 135,77 129,65" fill="url(#lily-accent-grad)" opacity="0.8" transform="rotate(135 135 65)" />
            <circle cx="135" cy="65" r="3.5" fill="#080f0d" />
            <circle cx="135" cy="65" r="1.5" fill={hot} />
          </g>
        </svg>
      );

    case "bloom":
      return (
        <svg className="feature-illo" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="bloom-bg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#080f0d" />
              <stop offset="100%" stopColor="#0e1714" />
            </linearGradient>
            <radialGradient id="bloom-glow" cx="50%" cy="45%" r="50%">
              <stop offset="0%" stopColor={hot} stopOpacity="0.06" />
              <stop offset="100%" stopColor={hot} stopOpacity="0" />
            </radialGradient>

            <linearGradient id="bloom-front-1" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor={hotSoft} stopOpacity="0.1" />
              <stop offset="100%" stopColor={petal} stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="bloom-front-2" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor={hot} stopOpacity="0.1" />
              <stop offset="100%" stopColor={hot} stopOpacity="0.75" />
            </linearGradient>

            <linearGradient id="bloom-back-1" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor={hotSoft} stopOpacity="0.0" />
              <stop offset="100%" stopColor={petal} stopOpacity="0.25" />
            </linearGradient>
            <linearGradient id="bloom-back-2" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor={hot} stopOpacity="0.0" />
              <stop offset="100%" stopColor={hotSoft} stopOpacity="0.35" />
            </linearGradient>
          </defs>

          {/* Background */}
          <rect width="200" height="160" fill="url(#bloom-bg)" />
          <circle cx="100" cy="70" r="75" fill="url(#bloom-glow)" />

          {/* Architectural Grid */}
          <g stroke={stem} strokeWidth="1" strokeOpacity="0.15">
            <line x1="100" y1="15" x2="100" y2="145" strokeDasharray="2 4" />
            <line x1="30" y1="120" x2="170" y2="120" />
            <line x1="97" y1="15" x2="103" y2="15" />
            <line x1="97" y1="145" x2="103" y2="145" />
            <line x1="30" y1="118" x2="30" y2="122" />
            <line x1="170" y1="118" x2="170" y2="122" />
          </g>

          {/* Back Shell */}
          <g stroke={petal} strokeWidth="0.75" strokeOpacity="0.3" strokeLinejoin="round">
            <polygon points="100,100 90,50 100,25" fill="url(#bloom-back-1)" />
            <polygon points="100,100 110,50 100,25" fill="url(#bloom-back-2)" />
            
            <polygon points="100,100 90,50 80,35" fill="url(#bloom-back-2)" />
            <polygon points="100,100 70,65 80,35" fill="url(#bloom-back-1)" />
            
            <polygon points="100,100 110,50 120,35" fill="url(#bloom-back-1)" />
            <polygon points="100,100 130,65 120,35" fill="url(#bloom-back-2)" />
            
            <polygon points="100,100 70,65 55,50" fill="url(#bloom-back-1)" />
            <polygon points="100,100 45,75 55,50" fill="url(#bloom-back-2)" />
            
            <polygon points="100,100 130,65 145,50" fill="url(#bloom-back-2)" />
            <polygon points="100,100 155,75 145,50" fill="url(#bloom-back-1)" />
          </g>

          {/* Stamen Core */}
          <g stroke={hot} strokeWidth="1" strokeLinecap="round" strokeOpacity="0.8">
            <line x1="100" y1="95" x2="100" y2="55" />
            <line x1="100" y1="95" x2="90" y2="58" />
            <line x1="100" y1="95" x2="110" y2="58" />
            <line x1="100" y1="95" x2="80" y2="65" />
            <line x1="100" y1="95" x2="120" y2="65" />
          </g>
          <g fill={hot} opacity="0.9">
            <polygon points="100,51 103,55 100,59 97,55" />
            <polygon points="90,55 92.5,58 90,61 87.5,58" />
            <polygon points="110,55 112.5,58 110,61 107.5,58" />
            <polygon points="80,62 82,65 80,68 78,65" />
            <polygon points="120,62 122,65 120,68 118,65" />
          </g>
          <g fill={petal} opacity="0.9">
            <polygon points="100,53 101.5,55 100,57 98.5,55" />
            <polygon points="90,56.5 91,58 90,59.5 89,58" />
            <polygon points="110,56.5 111,58 110,59.5 109,58" />
          </g>

          {/* Front Shell */}
          <g stroke={hot} strokeWidth="1" strokeOpacity="0.7" strokeLinejoin="round">
            <polygon points="100,110 55,80 35,75" fill="url(#bloom-front-2)" />
            <polygon points="100,110 45,95 35,75" fill="url(#bloom-front-1)" />

            <polygon points="100,110 145,80 165,75" fill="url(#bloom-front-1)" />
            <polygon points="100,110 155,95 165,75" fill="url(#bloom-front-2)" />

            <polygon points="100,110 85,85 65,60" fill="url(#bloom-front-1)" />
            <polygon points="100,110 55,80 65,60" fill="url(#bloom-front-2)" />

            <polygon points="100,110 115,85 135,60" fill="url(#bloom-front-2)" />
            <polygon points="100,110 145,80 135,60" fill="url(#bloom-front-1)" />

            <polygon points="100,110 85,85 100,75" fill="url(#bloom-front-2)" />
            <polygon points="100,110 115,85 100,75" fill="url(#bloom-front-1)" />
          </g>

          {/* Stem */}
          <line x1="100" y1="120" x2="100" y2="160" stroke={stem} strokeWidth="2" strokeLinecap="round" />

          {/* Leaves */}
          <g stroke={leafLight} strokeWidth="0.75" strokeLinejoin="round">
            <polygon points="100,132 125,118 150,125" fill={leaf} fillOpacity="0.9" />
            <polygon points="100,132 130,136 150,125" fill={stem} fillOpacity="0.9" />

            <polygon points="100,142 80,130 55,138" fill={leafLight} fillOpacity="0.8" />
            <polygon points="100,142 75,148 55,138" fill={stem} fillOpacity="0.9" />
          </g>

          {/* Receptacle */}
          <g stroke={leafLight} strokeWidth="1" strokeLinejoin="round">
            <polygon points="100,108 86,104 93,118 100,122" fill={leaf} />
            <polygon points="100,108 114,104 107,118 100,122" fill={leaf} />
            <polygon points="93,118 107,118 100,128" fill={leafLight} />
          </g>
        </svg>
      );

    case "reeds":
      return (
        <svg className="feature-illo" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="bg-reeds" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#080f0d" />
              <stop offset="100%" stopColor="#0e1714" />
            </linearGradient>
            <linearGradient id="reed-head-1" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={hot} />
              <stop offset="100%" stopColor={hotSoft} />
            </linearGradient>
            <linearGradient id="reed-head-2" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={petal} />
              <stop offset="100%" stopColor={hotSoft} />
            </linearGradient>
            <linearGradient id="water-fade" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0e1714" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#0e1714" stopOpacity="1" />
            </linearGradient>
          </defs>

          <rect width="200" height="160" fill="url(#bg-reeds)" />

          {/* Architectural background grid */}
          <path d="M 0 120 L 200 120" stroke={leaf} strokeWidth="1" opacity="0.1" strokeDasharray="2 6" />
          <path d="M 0 140 L 200 140" stroke={leaf} strokeWidth="1" opacity="0.1" strokeDasharray="2 6" />

          {/* Architectural Sightlines */}
          <line x1="86" y1="0" x2="86" y2="25" stroke={hot} strokeWidth="1" opacity="0.15" strokeDasharray="1 3" />
          <line x1="158" y1="0" x2="158" y2="35" stroke={petal} strokeWidth="1" opacity="0.15" strokeDasharray="1 3" />
          <line x1="50" y1="0" x2="50" y2="45" stroke={petal} strokeWidth="1" opacity="0.1" strokeDasharray="1 3" />

          {/* Back Layer Leaves */}
          <path d="M 86 160 Q 70 90 60 40 Q 78 95 86 160" fill={leaf} opacity="0.25" />
          <path d="M 122 160 Q 137 100 157 50 Q 130 105 122 160" fill={leaf} opacity="0.25" />

          {/* Background Stems */}
          <line x1="68" y1="160" x2="68" y2="65" stroke={stem} strokeWidth="1.5" opacity="0.4" strokeLinecap="round" />
          <line x1="104" y1="160" x2="104" y2="45" stroke={stem} strokeWidth="1.5" opacity="0.4" strokeLinecap="round" />
          <line x1="140" y1="160" x2="140" y2="70" stroke={stem} strokeWidth="1.5" opacity="0.4" strokeLinecap="round" />

          {/* Main Stems */}
          <line x1="50" y1="160" x2="50" y2="45" stroke={stem} strokeWidth="2" strokeLinecap="round" />
          <line x1="86" y1="160" x2="86" y2="25" stroke={stem} strokeWidth="2" strokeLinecap="round" />
          <line x1="122" y1="160" x2="122" y2="60" stroke={stem} strokeWidth="2" strokeLinecap="round" />
          <line x1="158" y1="160" x2="158" y2="35" stroke={stem} strokeWidth="2" strokeLinecap="round" />

          {/* Front Layer Leaves */}
          <path d="M 50 160 Q 36 100 26 60 Q 41 105 50 160" fill={leafLight} opacity="0.5" />
          <path d="M 86 160 Q 105 100 120 45 Q 98 105 86 160" fill={leafLight} opacity="0.4" />
          <path d="M 122 160 Q 110 110 105 75 Q 116 115 122 160" fill={leafLight} opacity="0.4" />
          <path d="M 158 160 Q 173 95 183 55 Q 166 100 158 160" fill={leafLight} opacity="0.5" />

          {/* Abstract halos around primary reeds */}
          <circle cx="50" cy="70" r="12" stroke={petal} strokeWidth="1" opacity="0.15" fill="none" />
          <circle cx="86" cy="62" r="22" stroke={hotSoft} strokeWidth="1" opacity="0.25" fill="none" />
          <circle cx="86" cy="62" r="32" stroke={stem} strokeWidth="1" opacity="0.15" fill="none" strokeDasharray="2 4" />
          <circle cx="158" cy="63" r="16" stroke={petal} strokeWidth="1" opacity="0.2" fill="none" />

          {/* Reed Heads */}
          <rect x="47.5" y="60" width="5" height="20" rx="2.5" fill="url(#reed-head-2)" opacity="0.9" />
          <rect x="82.5" y="45" width="7" height="34" rx="3.5" fill="url(#reed-head-1)" />
          <rect x="119.5" y="75" width="5" height="18" rx="2.5" fill={petal} opacity="0.85" />
          <rect x="155" y="50" width="6" height="26" rx="3" fill="url(#reed-head-1)" opacity="0.95" />

          {/* Water Fade (Submerges the stems) */}
          <rect x="0" y="140" width="200" height="20" fill="url(#water-fade)" />
          
          {/* Water Surface Line */}
          <line x1="0" y1="140" x2="200" y2="140" stroke={stem} strokeWidth="1" opacity="0.4" />

          {/* Clean Geometric Reflections / Ripples */}
          <rect x="44" y="144" width="12" height="2" rx="1" fill={leafLight} opacity="0.3" />
          <rect x="80" y="148" width="12" height="2" rx="1" fill={hotSoft} opacity="0.4" />
          <rect x="116" y="145" width="12" height="2" rx="1" fill={stem} opacity="0.5" />
          <rect x="152" y="147" width="12" height="2" rx="1" fill={petal} opacity="0.3" />
          
          <rect x="83" y="152" width="6" height="1.5" rx="0.75" fill={hot} opacity="0.3" />
          <rect x="47" y="148" width="6" height="1.5" rx="0.75" fill={leafLight} opacity="0.2" />
        </svg>
      );

    case "ripples":
      return (
        <svg className="feature-illo" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="bg-grad-ripples" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#080f0d" />
              <stop offset="100%" stopColor="#0e1714" />
            </linearGradient>
            <linearGradient id="pad-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#080f0d" />
              <stop offset="100%" stopColor="#0a1310" />
            </linearGradient>
          </defs>
          
          <rect width="200" height="160" fill="url(#bg-grad-ripples)" />

          {/* Tertiary Ripples (Bottom Right) */}
          <g className="art-ripple-3">
            <circle cx="160" cy="120" r="20" stroke={petal} strokeWidth="1" fill="none" opacity="0.3" />
            <circle cx="160" cy="120" r="44" stroke={leaf} strokeWidth="1" fill="none" opacity="0.2" strokeDasharray="3 5" />
            <circle cx="160" cy="120" r="74" stroke={stem} strokeWidth="1" fill="none" opacity="0.1" />
            
            <path d="M 155 120 L 165 120" stroke={petal} strokeWidth="1" opacity="0.4" />
            <path d="M 160 115 L 160 125" stroke={petal} strokeWidth="1" opacity="0.4" />
          </g>

          {/* Secondary Ripples (Top Left) */}
          <g className="art-ripple-2">
            <circle cx="60" cy="40" r="16" stroke={hotSoft} strokeWidth="1" fill="none" opacity="0.4" />
            <circle cx="60" cy="40" r="32" stroke={leafLight} strokeWidth="1" fill="none" opacity="0.3" strokeDasharray="2 4" />
            <circle cx="60" cy="40" r="56" stroke={stem} strokeWidth="1" fill="none" opacity="0.2" />
            <circle cx="60" cy="40" r="88" stroke={stem} strokeWidth="1" fill="none" opacity="0.1" />
            
            <path d="M 55 40 L 65 40" stroke={hotSoft} strokeWidth="1" opacity="0.5" />
            <path d="M 60 35 L 60 45" stroke={hotSoft} strokeWidth="1" opacity="0.5" />
          </g>

          {/* Primary Ripples (Center) */}
          <g className="art-ripple-1">
            <circle cx="100" cy="80" r="12" stroke={hot} strokeWidth="1.5" fill="none" opacity="0.8" />
            <circle cx="100" cy="80" r="28" stroke={petal} strokeWidth="1" fill="none" opacity="0.6" />
            <circle cx="100" cy="80" r="50" stroke={leafLight} strokeWidth="1" fill="none" opacity="0.4" strokeDasharray="8 4" />
            <circle cx="100" cy="80" r="76" stroke={leaf} strokeWidth="1.5" fill="none" opacity="0.25" strokeDasharray="4 6" />
            <circle cx="100" cy="80" r="108" stroke={leafLight} strokeWidth="2" fill="none" opacity="0.1" strokeDasharray="1 8" />
            <circle cx="100" cy="80" r="146" stroke={stem} strokeWidth="1" fill="none" opacity="0.1" />
            
            <circle cx="100" cy="80" r="2" fill={hot} opacity="0.9" />
            <circle cx="100" cy="80" r="6" stroke={hot} strokeWidth="1" fill="none" opacity="0.6" />
            
            <path d="M 85 80 L 115 80" stroke={hot} strokeWidth="1" opacity="0.5" />
            <path d="M 100 65 L 100 95" stroke={hot} strokeWidth="1" opacity="0.5" />
          </g>

          {/* Architectural Lilypads */}
          <g className="art-lilypads">
            {/* Lilypad 1 - Bottom Left */}
            <g className="art-lilypad-1">
              <path d="M 50 110 L 86 110 A 36 36 0 1 1 75.46 84.54 Z" fill="url(#pad-grad)" stroke={leafLight} strokeWidth="1.5" opacity="0.9" />
              <path d="M 50 110 L 76 110 A 26 26 0 1 1 68.38 91.62 Z" fill="none" stroke={leaf} strokeWidth="1" opacity="0.7" />
              <path d="M 50 110 L 66 110 A 16 16 0 1 1 61.31 98.69 Z" fill="none" stroke={leaf} strokeWidth="1" opacity="0.5" />
              
              {/* Drafting lines for the cutout */}
              <path d="M 50 110 L 86 110" stroke={hotSoft} strokeWidth="1" opacity="0.5" strokeDasharray="1 3" />
              <path d="M 50 110 L 75.46 84.54" stroke={hotSoft} strokeWidth="1" opacity="0.5" strokeDasharray="1 3" />
              
              <circle cx="50" cy="110" r="3" fill={hotSoft} opacity="0.9" />
              <circle cx="50" cy="110" r="6" stroke={hotSoft} strokeWidth="1" fill="none" opacity="0.4" />
            </g>

            {/* Lilypad 2 - Top Right */}
            <g className="art-lilypad-2">
              <path d="M 150 40 L 126 40 A 24 24 0 1 1 133.03 56.97 Z" fill="url(#pad-grad)" stroke={hotSoft} strokeWidth="1.5" opacity="0.9" />
              <path d="M 150 40 L 134 40 A 16 16 0 1 1 138.69 51.31 Z" fill="none" stroke={petal} strokeWidth="1" opacity="0.7" />
              <path d="M 150 40 L 142 40 A 8 8 0 1 1 144.34 45.66 Z" fill="none" stroke={petal} strokeWidth="1" opacity="0.5" />
              
              {/* Drafting lines for the cutout */}
              <path d="M 150 40 L 126 40" stroke={hot} strokeWidth="1" opacity="0.6" strokeDasharray="1 3" />
              <path d="M 150 40 L 133.03 56.97" stroke={hot} strokeWidth="1" opacity="0.6" strokeDasharray="1 3" />
              
              <circle cx="150" cy="40" r="2.5" fill={hot} opacity="1" />
            </g>

            {/* Lilypad 3 - Bottom Right */}
            <g className="art-lilypad-3">
              <path d="M 130 130 L 130 116 A 14 14 0 1 1 120.1 120.1 Z" fill="url(#pad-grad)" stroke={leafLight} strokeWidth="1" opacity="0.85" />
              <path d="M 130 130 L 130 122 A 8 8 0 1 1 124.34 124.34 Z" fill="none" stroke={leaf} strokeWidth="1" opacity="0.6" />
              
              {/* Drafting lines for the cutout */}
              <path d="M 130 130 L 130 116" stroke={hotSoft} strokeWidth="1" opacity="0.4" strokeDasharray="1 2" />
              <path d="M 130 130 L 120.1 120.1" stroke={hotSoft} strokeWidth="1" opacity="0.4" strokeDasharray="1 2" />
              
              <circle cx="130" cy="130" r="1.5" fill={hotSoft} opacity="0.9" />
            </g>
          </g>
        </svg>
      );

    case "stream":
      return (
        <svg className="feature-illo" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="bg-grad-stream" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#080f0d" />
              <stop offset="100%" stopColor="#0e1714" />
            </linearGradient>

            <linearGradient id="flow-grad-1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={petal} stopOpacity="0" />
              <stop offset="30%" stopColor={petal} stopOpacity="0.4" />
              <stop offset="70%" stopColor={hot} stopOpacity="0.8" />
              <stop offset="100%" stopColor={hotSoft} stopOpacity="0" />
            </linearGradient>

            <linearGradient id="flow-grad-2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={hotSoft} stopOpacity="0" />
              <stop offset="40%" stopColor={hotSoft} stopOpacity="0.6" />
              <stop offset="80%" stopColor={petal} stopOpacity="0.6" />
              <stop offset="100%" stopColor={hot} stopOpacity="0" />
            </linearGradient>

            <linearGradient id="leaf-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={leafLight} />
              <stop offset="100%" stopColor={leaf} />
            </linearGradient>

            <linearGradient id="leaf-grad-2" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={leaf} />
              <stop offset="100%" stopColor={stem} />
            </linearGradient>
          </defs>

          <rect width="200" height="160" fill="url(#bg-grad-stream)" />

          {/* Architectural Grid */}
          <line x1="0" y1="40" x2="200" y2="40" stroke={leafLight} strokeWidth="0.5" strokeDasharray="2 4" opacity="0.15" />
          <line x1="0" y1="120" x2="200" y2="120" stroke={leafLight} strokeWidth="0.5" strokeDasharray="2 4" opacity="0.15" />
          <line x1="100" y1="0" x2="100" y2="160" stroke={leafLight} strokeWidth="0.5" strokeDasharray="2 4" opacity="0.15" />
          <line x1="140" y1="0" x2="140" y2="160" stroke={leafLight} strokeWidth="0.5" strokeDasharray="1 3" opacity="0.1" />
          <line x1="60" y1="0" x2="60" y2="160" stroke={leafLight} strokeWidth="0.5" strokeDasharray="1 3" opacity="0.1" />

          {/* Stream Flow Lines */}
          <g className="art-stream-flow">
            <path d="M -20 60 C 60 60, 140 120, 220 120" stroke="url(#flow-grad-1)" strokeWidth="1.5" fill="none" opacity="0.9" />
            <path d="M -20 70 C 60 70, 140 130, 220 130" stroke="url(#flow-grad-2)" strokeWidth="1" fill="none" opacity="0.7" />
            <path d="M -20 80 C 60 80, 140 140, 220 140" stroke="url(#flow-grad-1)" strokeWidth="2" fill="none" opacity="0.5" />
            <path d="M -20 90 C 60 90, 140 150, 220 150" stroke="url(#flow-grad-2)" strokeWidth="0.5" fill="none" opacity="0.8" />
            <path d="M -20 100 C 60 100, 140 160, 220 160" stroke="url(#flow-grad-1)" strokeWidth="1" fill="none" opacity="0.4" />

            <path d="M -20 140 C 80 140, 120 70, 220 70" stroke="url(#flow-grad-2)" strokeWidth="1.5" fill="none" opacity="0.6" />
            <path d="M -20 150 C 80 150, 120 80, 220 80" stroke="url(#flow-grad-1)" strokeWidth="0.5" fill="none" opacity="0.8" />
            <path d="M -20 160 C 80 160, 120 90, 220 90" stroke="url(#flow-grad-2)" strokeWidth="1" fill="none" opacity="0.4" />
          </g>

          {/* Water Ripples */}
          <g className="art-stream-ripples">
            <ellipse cx="140" cy="130" rx="20" ry="5" stroke={hotSoft} strokeWidth="1" fill="none" opacity="0.5" />
            <ellipse cx="140" cy="130" rx="30" ry="7.5" stroke={petal} strokeWidth="0.5" fill="none" opacity="0.3" />

            <ellipse cx="60" cy="110" rx="15" ry="3.75" stroke={hot} strokeWidth="1" fill="none" opacity="0.4" />
            <ellipse cx="60" cy="110" rx="22" ry="5.5" stroke={petal} strokeWidth="0.5" fill="none" opacity="0.2" />
          </g>

          {/* Plant Left */}
          <g className="art-plant-left">
            <line x1="60" y1="60" x2="60" y2="160" stroke={stem} strokeWidth="2" />
            
            <path d="M 60 70 A 14 14 0 0 0 60 98 Z" fill="url(#leaf-grad-1)" />
            <path d="M 60 110 A 18 18 0 0 0 60 146 Z" fill="url(#leaf-grad-2)" opacity="0.9" />
            <path d="M 60 118 A 10 10 0 0 0 60 138" stroke="#080f0d" strokeWidth="1.5" fill="none" opacity="0.6" />

            <path d="M 60 85 A 12 12 0 0 1 60 109 Z" fill="url(#leaf-grad-2)" opacity="0.85" />
            <path d="M 60 125 A 15 15 0 0 1 60 155 Z" fill="url(#leaf-grad-1)" opacity="0.8" />

            <circle cx="60" cy="60" r="3" fill={petal} />
            <circle cx="60" cy="60" r="6" stroke={hot} strokeWidth="1.5" fill="none" opacity="0.8" />
            <circle cx="60" cy="60" r="10" stroke={hotSoft} strokeWidth="0.5" fill="none" opacity="0.5" strokeDasharray="1 3" />
          </g>

          {/* Plant Right */}
          <g className="art-plant-right">
            <line x1="140" y1="20" x2="140" y2="160" stroke={stem} strokeWidth="2" />
            
            <path d="M 140 30 A 18 18 0 0 1 140 66 Z" fill="url(#leaf-grad-1)" />
            <path d="M 140 75 A 24 24 0 0 1 140 123 Z" fill="url(#leaf-grad-2)" />
            <path d="M 140 85 A 14 14 0 0 1 140 113" stroke="#080f0d" strokeWidth="1.5" fill="none" opacity="0.6" />
            <path d="M 140 130 A 15 15 0 0 1 140 160 Z" fill="url(#leaf-grad-1)" opacity="0.8" />

            <path d="M 140 45 A 12 12 0 0 0 140 69 Z" fill="url(#leaf-grad-2)" opacity="0.9" />
            <path d="M 140 85 A 20 20 0 0 0 140 125 Z" fill="url(#leaf-grad-1)" opacity="0.9" />
            <path d="M 140 93 A 12 12 0 0 0 140 117" stroke="#080f0d" strokeWidth="1.5" fill="none" opacity="0.6" />

            <circle cx="140" cy="20" r="4" fill={hot} />
            <circle cx="140" cy="20" r="8" stroke={petal} strokeWidth="1.5" fill="none" opacity="0.9" />
            <circle cx="140" cy="20" r="14" stroke={hotSoft} strokeWidth="1" fill="none" opacity="0.6" />
            <circle cx="140" cy="20" r="22" stroke={hot} strokeWidth="0.5" fill="none" opacity="0.3" strokeDasharray="2 4" />
          </g>
        </svg>
      );

    case "lotus":
      return (
        <svg className="feature-illo" viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="water-grad-6" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#080e0c" />
              <stop offset="100%" stopColor="#12201b" />
            </linearGradient>

            <linearGradient id="fill-center-lotus" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={hot} stopOpacity="0.25" />
              <stop offset="100%" stopColor={hot} stopOpacity="0" />
            </linearGradient>

            <linearGradient id="fill-1-lotus" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={petal} stopOpacity="0.2" />
              <stop offset="100%" stopColor={petal} stopOpacity="0" />
            </linearGradient>

            <linearGradient id="fill-2-lotus" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={hotSoft} stopOpacity="0.15" />
              <stop offset="100%" stopColor={hotSoft} stopOpacity="0" />
            </linearGradient>

            <linearGradient id="fill-3-lotus" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={stem} stopOpacity="0.15" />
              <stop offset="100%" stopColor={stem} stopOpacity="0" />
            </linearGradient>
          </defs>

          <rect width="200" height="160" fill="url(#water-grad-6)" />

          {/* Architectural Elevation Lines */}
          <g opacity="0.2">
            <path d="M 20 35 L 180 35" stroke={petal} strokeWidth="1" strokeDasharray="2 4" />
            <path d="M 20 55 L 180 55" stroke={petal} strokeWidth="1" strokeDasharray="2 4" />
            <path d="M 20 80 L 180 80" stroke={petal} strokeWidth="1" strokeDasharray="2 4" />
            <path d="M 20 105 L 180 105" stroke={petal} strokeWidth="1" strokeDasharray="2 4" />
          </g>

          {/* Architectural Circles */}
          <circle cx="100" cy="95" r="50" stroke={leaf} strokeWidth="1" fill="none" opacity="0.4" strokeDasharray="2 4" />
          <circle cx="100" cy="95" r="75" stroke={leafLight} strokeWidth="1" fill="none" opacity="0.15" />

          {/* Base Reflection Lines */}
          <g className="art-lotus-base">
            <path d="M 30 125 L 170 125" stroke={stem} strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
            <path d="M 50 132 L 150 132" stroke={leafLight} strokeWidth="1.5" opacity="0.6" strokeLinecap="round" />
            <path d="M 70 139 L 130 139" stroke={leaf} strokeWidth="1.5" opacity="0.4" strokeLinecap="round" />
            <path d="M 90 146 L 110 146" stroke={leaf} strokeWidth="1.5" opacity="0.2" strokeLinecap="round" />

            {/* Base Nodes */}
            <circle cx="30" cy="125" r="1.5" fill={stem} />
            <circle cx="170" cy="125" r="1.5" fill={stem} />
            <circle cx="50" cy="132" r="1.5" fill={leafLight} opacity="0.8" />
            <circle cx="150" cy="132" r="1.5" fill={leafLight} opacity="0.8" />
            <circle cx="70" cy="139" r="1.5" fill={leaf} opacity="0.6" />
            <circle cx="130" cy="139" r="1.5" fill={leaf} opacity="0.6" />
            <circle cx="90" cy="146" r="1.5" fill={leaf} opacity="0.4" />
            <circle cx="110" cy="146" r="1.5" fill={leaf} opacity="0.4" />
          </g>

          {/* Petals */}
          <g className="art-lotus-petals">
            {/* Petal 3 (Lowest, outermost) */}
            <path d="M 100 125 C 125 125, 170 115, 160 105 C 145 112, 120 122, 100 125 Z" fill="url(#fill-3-lotus)" stroke={stem} strokeWidth="1.2" />
            <path d="M 100 125 C 75 125, 30 115, 40 105 C 55 112, 80 122, 100 125 Z" fill="url(#fill-3-lotus)" stroke={stem} strokeWidth="1.2" />
            
            {/* Petal 2 */}
            <path d="M 100 125 C 135 120, 160 105, 145 80 C 130 95, 115 110, 100 125 Z" fill="url(#fill-2-lotus)" stroke={hotSoft} strokeWidth="1.2" />
            <path d="M 100 125 C 65 120, 40 105, 55 80 C 70 95, 85 110, 100 125 Z" fill="url(#fill-2-lotus)" stroke={hotSoft} strokeWidth="1.2" />

            {/* Structural Line Petal 2 */}
            <path d="M 100 125 C 120 115, 135 95, 145 80" stroke={hotSoft} strokeWidth="1" opacity="0.5" strokeDasharray="2 3" fill="none" />
            <path d="M 100 125 C 80 115, 65 95, 55 80" stroke={hotSoft} strokeWidth="1" opacity="0.5" strokeDasharray="2 3" fill="none" />

            {/* Petal 1 */}
            <path d="M 100 125 C 125 110, 140 85, 125 55 C 115 75, 105 100, 100 125 Z" fill="url(#fill-1-lotus)" stroke={petal} strokeWidth="1.5" />
            <path d="M 100 125 C 75 110, 60 85, 75 55 C 85 75, 95 100, 100 125 Z" fill="url(#fill-1-lotus)" stroke={petal} strokeWidth="1.5" />
            
            {/* Structural Line Petal 1 */}
            <path d="M 100 125 C 115 100, 120 80, 125 55" stroke={petal} strokeWidth="1" opacity="0.6" strokeDasharray="3 3" fill="none" />
            <path d="M 100 125 C 85 100, 80 80, 75 55" stroke={petal} strokeWidth="1" opacity="0.6" strokeDasharray="3 3" fill="none" />

            {/* Center Petal */}
            <path d="M 100 35 C 118 60, 118 100, 100 125 C 82 100, 82 60, 100 35 Z" fill="url(#fill-center-lotus)" stroke={hot} strokeWidth="1.5" />
            
            {/* Structural Line Center Petal */}
            <path d="M 100 125 L 100 35" stroke={hot} strokeWidth="1" opacity="0.7" strokeDasharray="4 4" fill="none" />
          </g>

          {/* Intersection Nodes (Apexes) */}
          <circle cx="125" cy="55" r="1.5" fill={petal} />
          <circle cx="75" cy="55" r="1.5" fill={petal} />
          <circle cx="145" cy="80" r="1.5" fill={hotSoft} />
          <circle cx="55" cy="80" r="1.5" fill={hotSoft} />
          <circle cx="160" cy="105" r="1.5" fill={stem} />
          <circle cx="40" cy="105" r="1.5" fill={stem} />
          <circle cx="100" cy="35" r="2" fill={hot} />
          <circle cx="100" cy="125" r="2.5" fill={hot} />

          {/* Apex Sparkle / Diamond */}
          <path d="M 100 21 L 103 27 L 100 33 L 97 27 Z" fill={hot} />
          <path d="M 100 24 L 101.5 27 L 100 30 L 98.5 27 Z" fill="#fff" opacity="0.4" />
        </svg>
      );
  }
}

export type { Motif };
export { FeatureArt };