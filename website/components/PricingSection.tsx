import React from 'react';
import { Check, Chrome } from 'lucide-react';
import { Button } from './Button';

export const PricingSection: React.FC = () => {
  return (
    <section className="py-24 bg-white" id="pricing">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-brand-600 font-semibold tracking-wide uppercase text-sm mb-3">Pricing</h2>
          <h3 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Simple, Transparent Pricing</h3>
          <p className="text-slate-600 text-lg">
            We believe essential tools should be accessible to everyone.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Free License */}
          <div className="relative p-8 bg-white border border-slate-200 rounded-2xl shadow-xl hover:shadow-2xl transition-shadow duration-300 flex flex-col">
            <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-brand-500 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-lg">
              Popular
            </div>

            <div className="mb-6">
              <h4 className="text-2xl font-bold text-slate-900 mb-2">Free / Open Source</h4>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-slate-900">$0</span>
                <span className="text-slate-500">/ lifetime</span>
              </div>
              <p className="text-slate-500 mt-2 text-sm">Licensed under AGPLv3. Best for personal use.</p>
            </div>

            <div className="space-y-4 mb-8 flex-grow">
              {[
                "Unlimited Bookmarks",
                "Auto-Generated Thumbnails",
                "Local Storage (100% Private)",
                "Dark & Light Themes",
                "Grid & List Views",
                "Instant Search",
                "Backup & Restore",
                "Priority Updates"
              ].map((feature, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 flex items-center justify-center text-green-600">
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className="text-slate-600">{feature}</span>
                </div>
              ))}
            </div>

            <Button className="w-full" icon={<Chrome size={18} />}>
              Add to Chrome
            </Button>
            <p className="text-center text-xs text-slate-400 mt-4">
              Compatible with Chrome, Brave, Edge & Opera
            </p>
          </div>

          {/* Commercial License */}
          <div className="relative p-8 bg-slate-50 border border-slate-200 rounded-2xl shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col">
            <div className="mb-6">
              <h4 className="text-2xl font-bold text-slate-900 mb-2">Commercial License</h4>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-slate-900">Contact Us</span>
              </div>
              <p className="text-slate-500 mt-2 text-sm">For proprietary or commercial use without AGPLv3 restrictions.</p>
            </div>

            <div className="space-y-4 mb-8 flex-grow">
              {[
                "Everything in Free",
                "Commercial Usage Rights",
                "No Open Source Requirement",
                "Priority Email Support",
                "Custom Feature Requests",
                "SLA Available"
              ].map((feature, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span className="text-slate-600">{feature}</span>
                </div>
              ))}
            </div>

            <Button variant="outline" className="w-full" onClick={() => window.location.href = 'mailto:support@palworks.ai'}>
              Contact Sales
            </Button>
            <p className="text-center text-xs text-slate-400 mt-4">
              Tailored for businesses and enterprises
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};