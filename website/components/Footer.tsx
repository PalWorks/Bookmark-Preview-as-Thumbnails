import React from 'react';
import { Chrome, Twitter, Github, Mail } from 'lucide-react';

interface FooterProps {
  onNavigate: (page: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  return (
    <footer className="bg-slate-900 text-white pt-16 pb-8 border-t border-slate-800">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          
          <div className="col-span-1 md:col-span-2">
            <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <span className="bg-brand-600 p-1 rounded-lg"><Chrome size={20} /></span>
              Bookmarks as Thumbnails
            </h3>
            <p className="text-slate-400 max-w-sm">
              The modern, privacy-focused bookmark manager for Chrome. 
              Open source and built for power users who love beautiful design.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-4">Product</h4>
            <ul className="space-y-2 text-slate-400">
              <li><button onClick={() => onNavigate('home')} className="hover:text-white transition-colors">Features</button></li>
              <li><button onClick={() => onNavigate('home')} className="hover:text-white transition-colors">Pricing</button></li>
              <li><a href="#" className="hover:text-white transition-colors">Changelog</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Roadmap</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-4">Legal & Support</h4>
            <ul className="space-y-2 text-slate-400">
              <li><button onClick={() => onNavigate('privacy')} className="hover:text-white transition-colors text-left">Privacy Policy</button></li>
              <li><button onClick={() => onNavigate('terms')} className="hover:text-white transition-colors text-left">Terms & Conditions</button></li>
              <li><button onClick={() => onNavigate('contact')} className="hover:text-white transition-colors text-left">Get in Touch</button></li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center text-slate-500 text-sm">
            <div className="flex gap-4 mb-4 md:mb-0">
              <a href="#" className="hover:text-white transition-colors"><Twitter size={18} /></a>
              <a href="#" className="hover:text-white transition-colors"><Github size={18} /></a>
              <a href="#" className="hover:text-white transition-colors"><Mail size={18} /></a>
            </div>
            <div className="flex flex-col md:flex-row items-center gap-2 md:gap-6">
                <p>© {new Date().getFullYear()} Bookmarks as Thumbnails. All rights reserved.</p>
                <p>Made with ❤️ using React & Tailwind.</p>
            </div>
        </div>
      </div>
    </footer>
  );
};