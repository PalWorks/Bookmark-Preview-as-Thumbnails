import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageSliderProps {
    images: string[];
    autoPlayInterval?: number;
}

export const ImageSlider: React.FC<ImageSliderProps> = ({
    images,
    autoPlayInterval = 5000
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [direction, setDirection] = useState(0);

    const nextSlide = React.useCallback(() => {
        setDirection(1);
        setCurrentIndex((prev) => (prev + 1) % images.length);
    }, [images.length]);

    const prevSlide = () => {
        setDirection(-1);
        setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
    };

    const goToSlide = (index: number) => {
        setDirection(index > currentIndex ? 1 : -1);
        setCurrentIndex(index);
    };

    useEffect(() => {
        const timer = setInterval(() => {
            nextSlide();
        }, autoPlayInterval);

        return () => clearInterval(timer);
    }, [nextSlide, autoPlayInterval]);

    const variants = {
        enter: (direction: number) => ({
            x: direction > 0 ? 1000 : -1000,
            opacity: 0
        }),
        center: {
            zIndex: 1,
            x: 0,
            opacity: 1
        },
        exit: (direction: number) => ({
            zIndex: 0,
            x: direction < 0 ? 1000 : -1000,
            opacity: 0
        })
    };

    return (
        <div className="relative w-full h-full group overflow-hidden rounded-xl bg-slate-100 shadow-2xl border border-slate-200">
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50">
                <AnimatePresence initial={false} custom={direction}>
                    <motion.img
                        key={currentIndex}
                        src={images[currentIndex]}
                        custom={direction}
                        variants={variants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={{
                            x: { type: "spring", stiffness: 300, damping: 30 },
                            opacity: { duration: 0.2 }
                        }}
                        className="absolute w-full h-full object-contain"
                        alt={`Slide ${currentIndex + 1}`}
                    />
                </AnimatePresence>
            </div>

            {/* Navigation Arrows */}
            <button
                onClick={(e) => { e.preventDefault(); prevSlide(); }}
                aria-label="Previous slide"
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 hover:bg-white shadow-lg text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
                <ChevronLeft size={24} />
            </button>
            <button
                onClick={(e) => { e.preventDefault(); nextSlide(); }}
                aria-label="Next slide"
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 hover:bg-white shadow-lg text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
                <ChevronRight size={24} />
            </button>

            {/* Dots */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                {images.map((_, index) => (
                    <button
                        key={index}
                        onClick={() => goToSlide(index)}
                        aria-label={`Go to slide ${index + 1}`}
                        className={`w-2.5 h-2.5 rounded-full transition-all ${index === currentIndex
                            ? 'bg-brand-600 w-6'
                            : 'bg-slate-400/50 hover:bg-slate-400'
                            }`}
                    />
                ))}
            </div>
        </div>
    );
};
