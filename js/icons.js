// Inline stroke icons (24x24 viewBox, currentColor). Kept tiny on purpose: no icon font, no CDN.
'use strict';
const wrap = paths => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const icons = {
  home: wrap('<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>'),
  activity: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  users: wrap('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M17.5 14a6 6 0 0 1 4 6"/>'),
  feedback: wrap('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6 8.5-6"/>'),
  reports: wrap('<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
  venues: wrap('<path d="M4 21V5.5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 14 5.5V21"/><path d="M14 10h4.5a1.5 1.5 0 0 1 1.5 1.5V21"/><path d="M2.5 21h19"/><path d="M7.5 8h3M7.5 12h3M7.5 16h3M17 14h0M17 18h0"/>'),
  feeds: wrap('<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5.5" cy="18.5" r="1.5" fill="currentColor" stroke="none"/>'),
  admins: wrap('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>'),
  search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>'),
  theme: wrap('<path d="M12 3a9 9 0 1 0 9 9c0-.5 0-1-.1-1.4A5.5 5.5 0 0 1 13.4 3.1 9 9 0 0 0 12 3Z"/>'),
  menu: wrap('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  signup: wrap('<circle cx="10" cy="8" r="3.5"/><path d="M3 20a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>'),
  signin: wrap('<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="m10 8 4 4-4 4M14 12H3"/>'),
  note: wrap('<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13 7 4 4"/>'),
  tag: wrap('<path d="M3 12.5V4h8.5l9 9-8.5 8.5-9-9Z"/><circle cx="7.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>'),
  user: wrap('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  dot: wrap('<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'),
  inbox: wrap('<path d="M3 13.5 5.5 5h13L21 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19v-5.5Z"/><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/>'),
  check: wrap('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  sparkle: wrap('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  copy: wrap('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15"/>'),
  external: wrap('<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v4.5A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-11A1.5 1.5 0 0 1 6.5 6H11"/>'),
  controls: wrap('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>'),
  system: wrap('<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6"/><path d="M4.5 12v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6"/>'),
  trash: wrap('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
  download: wrap('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 19h16"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
};
export const icon = name => icons[name] || icons.dot;
