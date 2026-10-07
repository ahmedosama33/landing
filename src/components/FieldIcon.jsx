const paths = {
  person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
  phone: <path d="m7 3 3 5-2 2a14 14 0 0 0 6 6l2-2 5 3-1 3c-.3.8-1.2 1.2-2 1C10 20 4 14 3 6c-.2-.8.2-1.7 1-2Z" />,
  email: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3 7 9 6 9-6" /></>,
  lipstick: <><path d="M8 14V6l6-3v11M8 8l6-3M7 14h10v7H7Z" /><path d="M7 17h10" /></>,
  serum: <><rect x="7" y="10" width="10" height="12" rx="2" /><path d="M9 10V6h6v4M10 6V3h4v3M10 16h4M12 14v4" /></>,
  brush: <><path d="M9 12 7 3h10l-2 9ZM9 9h6M10 12h4v8a2 2 0 0 1-4 0ZM10 3l1 6m3-6-1 6" /></>,
  cream: <><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M5 10V7h14v3M4 14h16M9 17h6" /></>,
  compact: <><ellipse cx="12" cy="17" rx="9" ry="5" /><path d="M4 14V8a8 8 0 0 1 16 0v6" /><ellipse cx="12" cy="7" rx="5" ry="4" /><path d="M10 17h4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  message: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5a9 9 0 1 1 18 0ZM8 10h8M8 14h5" />,
};

export default function FieldIcon({ name = 'serum', className = 'size-4' }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name] ?? paths.serum}</svg>;
}
