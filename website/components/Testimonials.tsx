import React from 'react';
import { motion } from 'framer-motion';

const testimonials = [
    {
        name: "Elena Torres",
        role: "Product Designer",
        content: "Does exactly what it says. Fits right into the UI, doesn't look janky like some other extensions I've tried.",
        image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=faces"
    },
    {
        name: "Tom Harris",
        role: "Startup Founder",
        content: "Finally found a way to separate newsletter spam from actual work emails without unsubscribing from everything.",
        image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=faces"
    },
    {
        name: "Robert Fox",
        role: "Operations Manager",
        content: "My inbox is usually a disaster zone. This helps me cordon off the mess a bit so I don't miss the important stuff.",
        image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=faces"
    },
    {
        name: "David Lin",
        role: "Agency Owner",
        content: "I handle 3 different client projects at once. Pinning label views for each client saves me so much clicking around.",
        image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=faces"
    },
    {
        name: "Sophie Kim",
        role: "Content Creator",
        content: "Installed it last week. Pretty chill extension, doesn't slow down Gmail which was my main worry.",
        image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=faces"
    },
    {
        name: "Linda Garcia",
        role: "Consultant",
        content: "Simple tool. I like that it doesn't track my data or ask for weird permissions.",
        image: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop&crop=faces"
    },
    {
        name: "Sarah Jenkins",
        role: "Freelance Designer",
        content: "Actually helps me keep track of invoices. I used to lose them in the main feed or forget to check the sidebar label.",
        image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces"
    },
    {
        name: "James Peterson",
        role: "Contractor",
        content: "I just pinned 'label:receipts' and 'from:amazon'. Makes tax season way less annoying when I can just see everything in one tab.",
        image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=100&h=100&fit=crop&crop=faces"
    },
    {
        name: "Chris Baker",
        role: "Sales Lead",
        content: "I use the 'has:attachment' search pin constantly. Saves me from digging through threads just to find that one PDF.",
        image: "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=100&h=100&fit=crop&crop=faces"
    }
];

const TestimonialCard = ({ name, role, content, image }: typeof testimonials[0]) => (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-6">
        <div className="flex items-center gap-4 mb-4">
            <img src={image} alt={name} className="w-10 h-10 rounded-full object-cover" />
            <div>
                <h4 className="font-bold text-slate-900 text-sm">{name}</h4>
                <p className="text-slate-500 text-xs">{role}</p>
            </div>
        </div>
        <p className="text-slate-600 text-sm leading-relaxed">"{content}"</p>
    </div>
);

const Column = ({ items, direction = "top" }: { items: typeof testimonials, direction?: "top" | "bottom" }) => {
    return (
        <div className="relative h-[600px] overflow-hidden">
            <motion.div
                initial={{ y: direction === "top" ? 0 : "-50%" }}
                animate={{ y: direction === "top" ? "-50%" : 0 }}
                transition={{
                    repeat: Infinity,
                    duration: 20,
                    ease: "linear"
                }}
                className="flex flex-col"
            >
                {[...items, ...items].map((item, idx) => (
                    <TestimonialCard key={`${item.name}-${idx}`} {...item} />
                ))}
            </motion.div>
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-white via-transparent to-white z-10" />
        </div>
    );
};

export const Testimonials = () => {
    const col1 = testimonials.slice(0, 3);
    const col2 = testimonials.slice(3, 6);
    const col3 = testimonials.slice(6, 9);

    return (
        <section className="py-24 bg-white overflow-hidden">
            <div className="container mx-auto px-4">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6">Customers love our app</h2>
                    <p className="text-xl text-slate-600">
                        Leaders using our extension save 10+ hours every week.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
                    <Column items={col1} direction="bottom" />
                    <Column items={col2} direction="top" />
                    <Column items={col3} direction="bottom" />
                </div>
            </div>
        </section>
    );
};
