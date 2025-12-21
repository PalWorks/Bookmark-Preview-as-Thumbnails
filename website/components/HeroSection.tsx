import React from 'react';
import { motion } from 'framer-motion';
import { Chrome } from 'lucide-react';
import { Button } from './Button';
import { ImageSlider } from './ImageSlider';

export const HeroSection: React.FC = () => {
  return (
    <section className="relative pt-24 pb-32 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-brand-500/10 rounded-full blur-3xl opacity-50" />
        <div className="absolute top-20 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl opacity-30" />
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto mb-16">
          {/* Version badge removed */}

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-5xl md:text-7xl font-extrabold tracking-tight text-slate-900 mb-6"
          >
            Stop Reading. <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-600 to-blue-600">Start Seeing.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xl text-slate-600 mb-10 leading-relaxed max-w-2xl"
          >
            Transform your boring bookmark lists into a vibrant, visual gallery.
            Instantly recognize your saved pages with auto-generated thumbnails.
            <br />
            <span className="font-medium text-slate-900">100% Private. Local First.</span>
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4"
          >
            <Button size="lg" icon={<Chrome size={20} />} className="w-full sm:w-auto">
              Add to Chrome - It's Free
            </Button>
            {/* Changelog button removed */}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="relative mx-auto"
        >
          {/* Placeholder for Scroller / Slider Window */}
          <div className="w-full max-w-5xl mx-auto h-[400px] md:h-[550px] rounded-xl shadow-2xl overflow-hidden">
            <ImageSlider images={[
              'images/tile-01.png',
              'images/tile-02.png',
              'images/tile-03.png',
              'images/tile-04.png',
              'images/tile-05.png'
            ]} />
          </div>

          {/* MockBrowser commented out as requested
          <MockBrowser /> 
          */}

          {/* Reflection effect */}
          <div className="absolute top-full left-0 right-0 h-24 bg-gradient-to-b from-white/20 to-transparent transform scale-y-[-1] opacity-20 blur-sm pointer-events-none" />
        </motion.div>
      </div>
    </section>
  );
};