import React, { useEffect } from 'react';

export const TallyForm: React.FC = () => {
  useEffect(() => {
    // Load Tally script
    const scriptUrl = "https://tally.so/widgets/embed.js";
    const existingScript = document.querySelector(`script[src="${scriptUrl}"]`);
    
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => {
        // @ts-ignore
        if (typeof Tally !== "undefined") {
          // @ts-ignore
          Tally.loadEmbeds();
        }
      };
      document.body.appendChild(script);
    } else {
        // @ts-ignore
        if (typeof Tally !== "undefined") {
            // @ts-ignore
            Tally.loadEmbeds();
        }
    }
  }, []);

  return (
    <section className="py-24 bg-slate-50" id="get-in-touch">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">Get in Touch</h2>
            <p className="text-slate-600 text-lg">We would love to hear from you. Please fill out the form below.</p>
        </div>
        <div className="max-w-4xl mx-auto">
             <iframe 
                data-tally-src="https://tally.so/embed/xXrvkE?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1&formEventsForwarding=1" 
                loading="lazy" 
                width="100%" 
                height="596" 
                frameBorder="0" 
                marginHeight={0} 
                marginWidth={0} 
                title="Bookmarks as Thumbnails - Get in Touch Form"
                className="w-full"
            ></iframe>
        </div>
      </div>
    </section>
  );
};