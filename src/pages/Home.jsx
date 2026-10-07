
import Reveal from '../components/Reveal.jsx';
import CareMotion from '../components/CareMotion.jsx';
import FieldIcon from '../components/FieldIcon.jsx';
import Form from "../components/contactform.jsx";
import logo from '../assets/RM LOGO.png';

export default function Home() {
    return (
        <div className="relative isolate min-h-screen bg-[radial-gradient(ellipse_at_top_right,#eadbb94d,transparent_55%)]">
            <Reveal as="header" className="relative z-10 mx-auto flex max-w-[1320px] items-center justify-between border-b border-[#e2dfd4] px-[52px] py-3.5 max-[1100px]:px-8 max-[800px]:px-6 max-[800px]:py-2.5">
                <a href="/" className="group inline-flex items-center gap-[18px] no-underline" aria-label="Royal Model home">
                    <img className="transition-transform duration-500 motion-safe:group-hover:scale-105 motion-safe:group-hover:-rotate-3 size-[84px] object-contain mix-blend-multiply max-[800px]:size-[68px]" src={logo} alt="Royal Model" />
                    <span className="border-l border-[#e2dfd4] pl-5 text-[10px] leading-[1.8] tracking-[2px] text-[#74736a] uppercase max-[800px]:pl-3.5 max-[800px]:text-[8px] max-[800px]:tracking-[1.4px] max-[420px]:hidden">A personal approach<br />to your confidence</span>
                </a>
                <a href="#enquiry" className="group flex items-center gap-6 text-[10px] font-[650] tracking-[1.6px] uppercase no-underline max-[420px]:gap-2.5 max-[420px]:text-[9px]">Let’s talk <span className="grid size-[34px] place-items-center rounded-full border border-[#c9bea6] text-[17px] transition duration-300 motion-safe:group-hover:rotate-45 motion-safe:group-hover:scale-110 group-hover:bg-[#e8d6ad]" aria-hidden="true">↗</span></a>
            </Reveal>
            <div className="relative z-10 mx-auto grid max-w-[1320px] grid-cols-[1fr_1.05fr] items-start gap-[86px] px-[52px] pt-[68px] pb-16 min-[1500px]:py-[88px] max-[1100px]:gap-10 max-[1100px]:px-8 max-[800px]:max-w-[620px] max-[800px]:grid-cols-1 max-[800px]:gap-[38px] max-[800px]:px-6 max-[800px]:pt-9 max-[800px]:pb-10 max-[420px]:px-5">
                <div className="pt-[26px] max-[800px]:pt-0">
                    <Reveal as="p" className="delay-75 flex items-center gap-3 text-[10px] font-[650] tracking-[2.1px] text-[#927130] uppercase before:block before:h-px before:w-[29px] before:bg-[#b39960] before:content-['']">Royal Model · United Arab Emirates</Reveal>
                    <Reveal as="h1" className="delay-150 mt-[29px] font-['Cormorant_Garamond',Georgia,serif] text-[clamp(58px,5.9vw,82px)] leading-[.99] font-normal tracking-[-2.9px] max-[1100px]:text-[65px] max-[420px]:text-[57px]">Confidence<br />begins<br /><em className="font-normal text-[#927130]">with you.</em></Reveal>
                    <Reveal as="p" className="delay-200 mt-[26px] max-w-[340px] text-sm leading-[1.9] text-[#757469] max-[800px]:max-w-[440px]">Your questions. Your goals. Your next step.<br />Start a conversation with our team and let’s find the right care for you.</Reveal>
                    <div className="motion-safe:animate-pulse [animation-duration:4s] my-9 flex max-w-[370px] items-center gap-[15px] text-[17px] text-[#b59a61] before:h-px before:flex-1 before:bg-[#ded8c9] before:content-[''] after:h-px after:flex-1 after:bg-[#ded8c9] after:content-[''] max-[800px]:my-[25px] max-[800px]:max-w-none" aria-hidden="true"><FieldIcon name="cream" className="size-5" /></div>
                    <div className="grid gap-6 max-[800px]:gap-4">
                        <Reveal className="group flex items-start gap-[17px]"><span className="transition-transform duration-300 motion-safe:group-hover:-translate-y-1 motion-safe:group-hover:scale-110 min-w-[25px] font-['Cormorant_Garamond',Georgia,serif] text-[25px] leading-none text-[#a58b56]">01</span><div><h3 className="transition-colors duration-300 group-hover:text-[#927130] mb-1.5 text-xs font-semibold">Tell us what’s on your mind</h3><p className="max-w-[300px] text-xs leading-[1.7] text-[#74736a]">Share what you’re interested in and how we can help.</p></div></Reveal>
                        <Reveal className="group flex items-start gap-[17px]"><span className="transition-transform duration-300 motion-safe:group-hover:-translate-y-1 motion-safe:group-hover:scale-110 min-w-[25px] font-['Cormorant_Garamond',Georgia,serif] text-[25px] leading-none text-[#a58b56]">02</span><div><h3 className="transition-colors duration-300 group-hover:text-[#927130] mb-1.5 text-xs font-semibold">Continue on WhatsApp</h3><p className="max-w-[300px] text-xs leading-[1.7] text-[#74736a]">Continue your enquiry with our team on WhatsApp.</p></div></Reveal>
                        <Reveal className="group flex items-start gap-[17px]"><span className="transition-transform duration-300 motion-safe:group-hover:-translate-y-1 motion-safe:group-hover:scale-110 min-w-[25px] font-['Cormorant_Garamond',Georgia,serif] text-[25px] leading-none text-[#a58b56]">03</span><div><h3 className="transition-colors duration-300 group-hover:text-[#927130] mb-1.5 text-xs font-semibold">Take the next step, together</h3><p className="max-w-[300px] text-xs leading-[1.7] text-[#74736a]">Our team will get in touch to discuss your enquiry.</p></div></Reveal>
                    </div>
                    <p className="mt-[38px] text-[9px] tracking-[2.3px] text-[#928878] uppercase max-[800px]:mt-[23px]">Thoughtful care. A personal conversation.</p>
                </div>
                <Form />
            </div>
            <Reveal as="footer" className="relative z-10 mx-auto flex max-w-[1216px] justify-between gap-4 border-t border-[#e2dfd4] pt-[23px] pb-[29px] text-[10px] tracking-[.3px] text-[#8a887d] max-[1100px]:mx-8 max-[800px]:mx-6 max-[800px]:flex-wrap"><span className="text-[11px] tracking-[2px] text-[#4e4b40] [&>span]:text-[#927130]">ROYAL <span>MODEL</span></span><span>United Arab Emirates · Personal care, closer to you.</span><span>© {new Date().getFullYear()} Royal Model</span></Reveal>
            <CareMotion />
        </div>
    );
}
