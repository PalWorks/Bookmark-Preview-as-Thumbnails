import React from 'react';
import { Shield, Database, Lock, WifiOff } from 'lucide-react';

export const PrivacySection: React.FC = () => {
  return (
    <section className="py-24 bg-white overflow-hidden">
      <div className="container mx-auto px-4">
        <div className="flex flex-col lg:flex-row items-center gap-16">
          
          {/* Content Side */}
          <div className="flex-1 space-y-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-green-50 text-green-700 text-sm font-medium border border-green-100">
                <Shield size={14} />
                <span>Privacy First Architecture</span>
            </div>
            
            <h2 className="text-3xl md:text-5xl font-bold text-slate-900">
              Your data stays on <br />
              <span className="text-green-600">your device. Period.</span>
            </h2>
            
            <p className="text-lg text-slate-600 leading-relaxed">
              Most "visual bookmark" tools upload your data to their clouds to generate screenshots. We don't. 
              Our engine runs 100% locally within your browser.
            </p>

            <ul className="space-y-4">
              {[
                { icon: Database, title: "IndexedDB Storage", desc: "Fast, persistent storage directly in Chrome." },
                { icon: WifiOff, title: "Offline Capable", desc: "Works perfectly without an internet connection." },
                { icon: Lock, title: "No Tracking", desc: "We have zero analytics. Your browsing is your business." }
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-4">
                  <div className="mt-1 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
                    <item.icon size={16} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900">{item.title}</h4>
                    <p className="text-slate-600 text-sm">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Visual Side */}
          <div className="flex-1 w-full relative">
            <div className="relative rounded-2xl bg-slate-900 p-8 shadow-2xl border border-slate-800">
               {/* Decorative Code Block */}
               <div className="flex gap-2 mb-4">
                 <div className="w-3 h-3 rounded-full bg-red-500"/>
                 <div className="w-3 h-3 rounded-full bg-yellow-500"/>
                 <div className="w-3 h-3 rounded-full bg-green-500"/>
               </div>
               <pre className="font-mono text-xs md:text-sm text-green-400 overflow-x-auto">
{`// storage.ts
export const saveThumbnail = async (id, blob) => {
  // Direct to IndexedDB
  const db = await openDB('bookmarks-db', 1);
  await db.put('thumbnails', {
    id: id,
    data: blob,
    timestamp: Date.now()
  });
  
  console.log('Saved locally!');
  // No fetch() calls to external servers
};`}
               </pre>
               
               <div className="absolute -bottom-6 -right-6 bg-white p-4 rounded-xl shadow-xl border border-slate-100 flex items-center gap-3 animate-bounce">
                  <div className="bg-green-100 p-2 rounded-lg text-green-600">
                    <Shield size={24} />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 uppercase font-bold">Security Audit</div>
                    <div className="font-bold text-slate-900">Passed</div>
                  </div>
               </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};