// SPDX-License-Identifier: AGPL-3.0-only
import React, { useState, useEffect, useRef } from 'react';
import { LayoutGrid, Play, ShieldCheck, Moon, X } from 'lucide-react';
import './WelcomeModal.css';

interface WelcomeModalProps {
    onClose: () => void;
    theme: 'light' | 'dark' | 'system';
    onSetTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ onClose, theme, onSetTheme }) => {
    const [step, setStep] = useState(0);
    const dialogRef = useRef<HTMLDivElement>(null);

    const steps = [
        {
            icon: <LayoutGrid size={40} />,
            title: "Visual Bookmarks",
            desc: "Transform your boring bookmark lists into a beautiful, visual gallery. Browse your saved pages with ease."
        },
        {
            icon: <Play size={40} />,
            title: "One-Click Previews",
            desc: "Click the 'Generate Preview' button in the top bar to automatically capture thumbnails for all your bookmarks."
        },
        {
            icon: <ShieldCheck size={40} />,
            title: "Your Data, Your Control",
            desc: "All data is stored locally. Use the Settings menu to back up your data or Connect a Folder for unlimited storage."
        },
        {
            icon: <Moon size={40} />,
            title: "Choose Your Theme",
            desc: "Select the look that fits your style.",
            isThemeChooser: true
        }
    ];

    const handleNext = () => {
        if (step < steps.length - 1) {
            setStep(step + 1);
        } else {
            onClose();
        }
    };

    const handleBack = () => {
        if (step > 0) {
            setStep(step - 1);
        }
    };

    // Focus moves into the dialog when it opens, so keyboard and screen reader users start here.
    useEffect(() => { dialogRef.current?.querySelector<HTMLElement>('.btn-primary')?.focus(); }, []);

    // Dismiss on Escape, like any standard modal; Tab stays inside the dialog.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { onClose(); return; }
            if (e.key !== 'Tab' || !dialogRef.current) return;
            const items = [...dialogRef.current.querySelectorAll<HTMLElement>('button')];
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="welcome-overlay">
            <div className="welcome-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
                <button className="welcome-close" onClick={onClose} title="Close" aria-label="Close">
                    <X size={20} />
                </button>
                <div className="welcome-content">
                    <div className="welcome-icon-wrapper">
                        {steps[step].icon}
                    </div>
                    <h2 className="welcome-title" id="welcome-title">{steps[step].title}</h2>
                    <p className="welcome-desc">{steps[step].desc}</p>

                    {/* Theme Chooser UI */}
                    {steps[step].isThemeChooser && (
                        <div className="theme-options">
                            <button
                                className={`theme-option-btn ${theme === 'light' ? 'active' : ''}`}
                                aria-pressed={theme === 'light'}
                                onClick={() => onSetTheme('light')}
                            >
                                Light
                            </button>
                            <button
                                className={`theme-option-btn ${theme === 'dark' ? 'active' : ''}`}
                                aria-pressed={theme === 'dark'}
                                onClick={() => onSetTheme('dark')}
                            >
                                Dark
                            </button>
                            <button
                                className={`theme-option-btn ${theme === 'system' ? 'active' : ''}`}
                                aria-pressed={theme === 'system'}
                                onClick={() => onSetTheme('system')}
                            >
                                System
                            </button>
                        </div>
                    )}
                </div>

                <div className="welcome-footer">
                    <div className="step-indicators" aria-label={`Step ${step + 1} of ${steps.length}`} role="img">
                        {steps.map((_, index) => (
                            <div
                                key={index}
                                className={`step-dot ${index === step ? 'active' : ''}`}
                            />
                        ))}
                    </div>

                    <div className="nav-buttons">
                        {step > 0 && (
                            <button className="btn-secondary" onClick={handleBack}>
                                Back
                            </button>
                        )}
                        <button className="btn-primary" onClick={handleNext}>
                            {step === steps.length - 1 ? "Get Started" : "Next"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
