import { useEffect, useRef, useState } from 'react';

// Reveal once as content enters the viewport, without an animation dependency.
export default function Reveal({ as: Tag = 'div', className = '', children, ...props }) {
  const element = useRef(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.08 });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      {...props}
      ref={element}
      data-visible={visible}
      onFocusCapture={() => setVisible(true)}
      className={`transition-[opacity,translate] duration-700 ease-out motion-safe:data-[visible=false]:translate-y-5 motion-safe:data-[visible=false]:opacity-0 motion-reduce:transition-none ${className}`}
    >
      {children}
    </Tag>
  );
}
