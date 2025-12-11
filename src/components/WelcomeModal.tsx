import React, { useState } from 'react';
import { LayoutGrid, Play, ShieldCheck, Moon } from 'lucide-react';
import './WelcomeModal.css';

interface WelcomeModalProps {
    onClose: () => void;
    theme: 'light' | 'dark' | 'system';
    onSetTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ onClose, theme, onSetTheme }) => {
    const [step, setStep] = useState(0);

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
            desc: "All data is stored locally. Use the Settings menu to Backup your data or Connect a Folder for unlimited storage."
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

    return (
        <div className="welcome-overlay">
            <div className="welcome-modal">
                <div className="welcome-content">
                    <div className="welcome-icon-wrapper">
                        {steps[step].icon}
                    </div>
                    <h2 className="welcome-title">{steps[step].title}</h2>
                    <p className="welcome-desc">{steps[step].desc}</p>

                    {/* Theme Chooser UI */}
                    {steps[step].isThemeChooser && (
                        <div className="theme-options">
                            <button
                                className={`theme-option-btn ${theme === 'light' ? 'active' : ''}`}
                                onClick={() => onSetTheme('light')}
                            >
                                Light
                            </button>
                            <button
                                className={`theme-option-btn ${theme === 'dark' ? 'active' : ''}`}
                                onClick={() => onSetTheme('dark')}
                            >
                                Dark
                            </button>
                            <button
                                className={`theme-option-btn ${theme === 'system' ? 'active' : ''}`}
                                onClick={() => onSetTheme('system')}
                            >
                                System
                            </button>
                        </div>
                    )}
                </div>

                <div className="welcome-footer">
                    <div className="step-indicators">
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
