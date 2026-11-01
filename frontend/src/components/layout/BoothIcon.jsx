export default function BoothIcon({
  direction = "left",
  kind = "return",
}) {
  if (kind === "cycle") {
    return (
      <svg
        className="booth-icon booth-icon--cycle"
        viewBox="0 0 48 48"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M39 30a16 16 0 1 1-4-18"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />

        <path
          d="m33 5 9 11-14 1Z"
          fill="currentColor"
        />

        <path
          d="m20 16 12 8-12 8Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (direction === "up" || direction === "down") {
    return (
      <svg
        className={`booth-icon booth-scroll-icon booth-scroll-icon--${direction}`}
        viewBox="0 0 48 48"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M17 5h14v22h11L24 44 6 27h11Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg
      className={`booth-icon booth-icon--${direction}`}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M19 5 3 18l16 12v-8c12 0 20 7 24 20 2-19-7-29-24-29V5Z"
      />
    </svg>
  );
}