function svgUrl(content) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
}

export const STICKERS = [
  {
    id: "glasses",
    name: "Kính",
    src: svgUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="240" height="90"
           viewBox="0 0 240 90">
        <g fill="#172033" fill-opacity=".82"
           stroke="#f472b6" stroke-width="9">
          <rect x="12" y="18" width="86" height="58" rx="22"/>
          <rect x="142" y="18" width="86" height="58" rx="22"/>
        </g>
        <path d="M98 38Q120 24 142 38M2 28H12M228 28H238"
              fill="none" stroke="#f472b6" stroke-width="9"/>
      </svg>
    `),
  },
  {
    id: "bunnyEars",
    name: "Tai thỏ",
    src: svgUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="220" height="210"
           viewBox="0 0 220 210">
        <ellipse cx="62" cy="90" rx="35" ry="84"
                 fill="#fff" stroke="#c4b5fd" stroke-width="7"
                 transform="rotate(-13 62 90)"/>
        <ellipse cx="158" cy="90" rx="35" ry="84"
                 fill="#fff" stroke="#c4b5fd" stroke-width="7"
                 transform="rotate(13 158 90)"/>
        <ellipse cx="62" cy="90" rx="17" ry="62"
                 fill="#f9a8d4" transform="rotate(-13 62 90)"/>
        <ellipse cx="158" cy="90" rx="17" ry="62"
                 fill="#f9a8d4" transform="rotate(13 158 90)"/>
        <path d="M22 190Q110 150 198 190" fill="none"
              stroke="#c4b5fd" stroke-width="18"
              stroke-linecap="round"/>
      </svg>
    `),
  },
  {
    id: "hat",
    name: "Mũ",
    src: svgUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="240" height="150"
           viewBox="0 0 240 150">
        <path d="M62 115L76 20Q120 0 164 20L178 115Z"
              fill="#7c3aed" stroke="#ddd6fe" stroke-width="6"/>
        <path d="M68 88H172L176 112H64Z" fill="#facc15"/>
        <ellipse cx="120" cy="122" rx="112" ry="20"
                 fill="#7c3aed" stroke="#ddd6fe" stroke-width="6"/>
      </svg>
    `),
  },
  {
    id: "lips",
    name: "Môi",
    src: svgUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" width="180" height="90"
           viewBox="0 0 180 90">
        <path d="M8 46Q55 0 90 26Q125 0 172 46
                 Q126 100 90 76Q54 100 8 46Z"
              fill="#f43f5e" stroke="#881337" stroke-width="5"/>
        <path d="M12 46Q90 62 168 46" fill="none"
              stroke="#881337" stroke-width="5"/>
      </svg>
    `),
  },
];