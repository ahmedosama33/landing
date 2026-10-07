import { useEffect, useRef, useState } from 'react';

export default function CareMotion() {
  const [paused, setPaused] = useState(false);
  const curve = useRef(null);
  const animation = useRef(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => {
      animation.current?.cancel();
      animation.current = null;
      if (preference.matches || !curve.current?.animate) return;
      animation.current = curve.current.animate([
        { strokeDashoffset: 1, opacity: 0, offset: 0 },
        { strokeDashoffset: 1, opacity: 1, offset: 0.04 },
        { strokeDashoffset: 0, opacity: 1, offset: 0.72 },
        { strokeDashoffset: 0, opacity: 1, offset: 0.9 },
        { strokeDashoffset: 0, opacity: 0, offset: 1 },
      ], { duration: 16000, iterations: Infinity, easing: 'ease-in-out' });
      if (pausedRef.current) animation.current.pause();
    };
    updateMotion();
    preference.addEventListener('change', updateMotion);
    return () => {
      animation.current?.cancel();
      preference.removeEventListener('change', updateMotion);
    };
  }, []);

  function toggleMotion() {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (pausedRef.current) animation.current?.pause();
    else animation.current?.play();
  }

  return (
    <>
      <div aria-hidden="true" className={`pointer-events-none absolute inset-0 z-0 overflow-hidden text-[#ac8d4a]/40 max-[800px]:text-[#ac8d4a]/25 ${paused ? '[&_*]:[animation-play-state:paused]' : ''}`}>
        <svg className="absolute inset-0 h-full w-full text-[#b99b60]/25 max-[800px]:text-[#b99b60]/15" viewBox="0 0 1440 1100" preserveAspectRatio="none" fill="none" focusable="false">
          <path ref={curve} d="M -60 185 C 180 25 510 60 550 230 S 325 535 120 440 S -85 690 210 830 S 865 1095 1285 900 S 1560 485 1320 265" pathLength="1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeDasharray="1" strokeDashoffset="0" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="relative z-10 mx-auto flex max-w-[1216px] justify-end px-6 pb-4">
        <button type="button" onClick={toggleMotion} aria-pressed={paused} className="cursor-pointer text-[10px] text-[#8d7d5b] underline-offset-4 hover:underline motion-reduce:hidden">
          {paused ? 'Resume decorative motion' : 'Pause decorative motion'}
        </button>
      </div>
    </>
  );
}
