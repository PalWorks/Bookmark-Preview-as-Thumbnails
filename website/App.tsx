import React, { useState, useEffect } from 'react';
import { HeroSection } from './components/HeroSection';
import { FeaturesSection } from './components/FeaturesSection';
import { PrivacySection } from './components/PrivacySection';
import { PricingSection } from './components/PricingSection';
import { Footer } from './components/Footer';
import { TallyForm } from './components/TallyForm';
import { Testimonials } from './components/Testimonials';
import { PrivacyPolicy, TermsAndConditions } from './components/Legal';
import { Chrome } from 'lucide-react';
import { Button } from './components/Button';

type Page = 'home' | 'privacy' | 'terms' | 'contact';

interface NavbarProps {
  onNavigate: (page: Page) => void;
}

const Navbar: React.FC<NavbarProps> = ({ onNavigate }) => {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <button onClick={() => onNavigate('home')} className="flex items-center gap-2 font-bold text-lg text-slate-900 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white">
            <Chrome size={18} />
          </div>
          <span>Bookmarks as Thumbnails</span>
        </button>

        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
          <button onClick={() => { onNavigate('home'); setTimeout(() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' }), 100) }} className="hover:text-brand-600 transition-colors">Features</button>
          <button onClick={() => { onNavigate('home'); setTimeout(() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' }), 100) }} className="hover:text-brand-600 transition-colors">How it works</button>
          <button onClick={() => { onNavigate('home'); setTimeout(() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' }), 100) }} className="hover:text-brand-600 transition-colors">Pricing</button>
        </div>

        <Button size="sm">Add to Chrome</Button>
      </div>
    </nav>
  );
};

const CTASection: React.FC = () => {
  return (
    <section className="py-24 bg-brand-900 relative overflow-hidden text-center">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
      <div className="container mx-auto px-4 relative z-10">
        <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">Ready to upgrade your browser?</h2>
        <p className="text-brand-200 text-xl mb-10 max-w-2xl mx-auto">
          Join thousands of users who have switched to a visual, private, and faster bookmarking experience.
        </p>
        <Button size="lg" className="bg-white text-brand-900 hover:bg-brand-50 shadow-none hover:shadow-lg">
          Add to Chrome - It's Free
        </Button>
        <p className="mt-4 text-brand-400 text-sm">Requires Chrome 88+ • No account needed</p>
      </div>
    </section>
  )
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('home');

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash === 'privacy') setCurrentPage('privacy');
      else if (hash === 'terms') setCurrentPage('terms');
      else if (hash === 'contact') setCurrentPage('contact');
      else setCurrentPage('home');

      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Initial check
    handleHashChange();

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleNavigate = (page: Page) => {
    if (page === 'home') window.location.hash = '';
    else window.location.hash = page;
  };

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <Navbar onNavigate={handleNavigate} />
      <main>
        {currentPage === 'home' && (
          <>
            <HeroSection />
            <div id="features">
              <FeaturesSection />
            </div>

            <div id="how-it-works">
              {/* Using Privacy Section as part of explaining "How it works" / Tech Stack */}
              <PrivacySection />
            </div>

            <PricingSection />

            <Testimonials />

            <TallyForm />
            <CTASection />
          </>
        )}

        {currentPage === 'privacy' && <PrivacyPolicy />}
        {currentPage === 'terms' && <TermsAndConditions />}
        {currentPage === 'contact' && (
          <div className="pt-24 pb-12">
            <div className="container mx-auto px-4 mb-12 text-center">
              <h1 className="text-4xl font-bold mb-4">Get in Touch</h1>
              <p className="text-slate-600">We'd love to hear from you.</p>
            </div>
            <TallyForm />
          </div>
        )}
      </main>
      <Footer onNavigate={handleNavigate} />
    </div>
  );
}

export default App;