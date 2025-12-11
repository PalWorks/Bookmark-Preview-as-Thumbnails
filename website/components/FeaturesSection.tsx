import React from 'react';
import { Camera, Zap, Shield, Layout, Moon, Search, FolderTree, Database } from 'lucide-react';
import { motion } from 'framer-motion';

const features = [
  {
    icon: Camera,
    title: "Auto-Snapshots",
    description: "One click captures a beautiful screenshot of any page. Our engine handles the cropping and resizing automatically."
  },
  {
    icon: Layout,
    title: "Grid & List Views",
    description: "Switch between immersive visual grids or density-optimized lists. Your bookmarks, your way."
  },
  {
    icon: Moon,
    title: "Dark & Light Mode",
    description: "Built-in themes that respect your system preferences. Looks stunning in pitch black or crisp white."
  },
  {
    icon: Search,
    title: "Instant Search",
    description: "Find that one link from 3 years ago in milliseconds. Filters results in real-time as you type."
  },
  {
    icon: FolderTree,
    title: "Visual Navigation",
    description: "Navigate complex folder hierarchies with ease using our clean, recursive sidebar interface."
  },
  {
    icon: Zap,
    title: "Lightning Fast",
    description: "Built with React, Vite, and highly optimized rendering. No lag, even with thousands of bookmarks."
  },
];

export const FeaturesSection: React.FC = () => {
  return (
    <section className="py-24 bg-slate-50" id="features">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-brand-600 font-semibold tracking-wide uppercase text-sm mb-3">Power User Features</h2>
          <h3 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Everything you need to manage the web</h3>
          <p className="text-slate-600 text-lg">
            We didn't just skin the default bookmark manager. We rebuilt it from the ground up for speed, aesthetics, and privacy.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
              className="bg-white p-8 rounded-2xl shadow-sm hover:shadow-md transition-shadow border border-slate-100"
            >
              <div className="w-12 h-12 bg-brand-50 rounded-xl flex items-center justify-center text-brand-600 mb-6">
                <feature.icon size={24} />
              </div>
              <h4 className="text-xl font-bold text-slate-900 mb-3">{feature.title}</h4>
              <p className="text-slate-600 leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};