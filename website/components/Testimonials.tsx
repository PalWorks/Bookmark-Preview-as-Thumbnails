// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import { Star, Images, Undo2, FolderTree, Sparkles } from 'lucide-react';

const REVIEWS_URL =
    'https://chromewebstore.google.com/detail/bookmarks-as-thumbnails/eedekafhclngkhhkcocblnllkbodgnhj/reviews';

// Real reviews only, copied word for word from the Chrome Web Store listing. Add new ones the same way.
const reviews = [
    {
        name: 'Tony Ash',
        rating: 5,
        content: 'The Best Bookmark manager. Very clean. I love it.',
        date: '24 September 2026',
        version: '1.2.0',
    },
];

// What the extension is built for. These describe features, not people, so they carry no names.
const uses = [
    {
        icon: Images,
        title: 'Find a page by how it looks',
        text: 'Hundreds of bookmarks become a grid of page previews, so you spot the one you want without reading titles.',
    },
    {
        icon: Undo2,
        title: 'Tidy up without fear',
        text: 'Deletes go to a 30-day Trash with Undo, and renames and moves can be undone too.',
    },
    {
        icon: FolderTree,
        title: 'Organise the way you think',
        text: 'Folder colours, star ratings, multi-select moves, and folders you can hide from search.',
    },
    {
        icon: Sparkles,
        title: 'Search in plain words',
        text: 'Optional AI tagging and natural-language search, on your device by default.',
    },
];

const Stars = ({ count }: { count: number }) => (
    <div className="flex gap-0.5" aria-label={`${count} out of 5 stars`}>
        {Array.from({ length: 5 }, (_, i) => (
            <Star
                key={i}
                size={18}
                className={i < count ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}
                aria-hidden="true"
            />
        ))}
    </div>
);

export const Testimonials = () => {
    return (
        <section className="py-24 bg-white overflow-hidden">
            <div className="container mx-auto px-4">
                <div className="text-center max-w-3xl mx-auto mb-12">
                    <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6">What users say</h2>
                    <p className="text-xl text-slate-600">From the Chrome Web Store.</p>
                </div>

                <div className="max-w-2xl mx-auto grid gap-6 mb-20">
                    {reviews.map((r) => (
                        <figure key={r.name} className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                            <Stars count={r.rating} />
                            <blockquote className="mt-4 text-xl text-slate-800 leading-relaxed">
                                "{r.content}"
                            </blockquote>
                            <figcaption className="mt-4 text-sm text-slate-500">
                                <span className="font-semibold text-slate-900">{r.name}</span>, Chrome Web Store review,{' '}
                                {r.date} (version {r.version})
                            </figcaption>
                        </figure>
                    ))}
                    <a
                        href={REVIEWS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-center text-brand-600 font-medium hover:underline"
                    >
                        Read reviews or write your own on the Chrome Web Store
                    </a>
                </div>

                <div className="text-center max-w-3xl mx-auto mb-12">
                    <h2 className="text-3xl md:text-4xl font-bold text-slate-900">What it is for</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {uses.map(({ icon: Icon, title, text }) => (
                        <div key={title} className="p-6 rounded-2xl bg-slate-50 border border-slate-100">
                            <div className="w-10 h-10 rounded-lg bg-brand-100 text-brand-600 flex items-center justify-center mb-4">
                                <Icon size={20} aria-hidden="true" />
                            </div>
                            <h3 className="font-bold text-slate-900 mb-2">{title}</h3>
                            <p className="text-slate-600 text-sm leading-relaxed">{text}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};
