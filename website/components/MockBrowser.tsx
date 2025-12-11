import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Grid, List, Sun, Moon, MoreVertical, Folder, ExternalLink, Globe, Code, ShoppingBag, Layout } from 'lucide-react';
import { ViewMode, ThemeMode, BookmarkMock } from '../types';

const MOCK_BOOKMARKS: BookmarkMock[] = [
  { id: '1', title: 'Dribbble - Discover', url: 'dribbble.com', color: 'bg-pink-500', icon: '🏀' },
  { id: '2', title: 'Tailwind CSS Docs', url: 'tailwindcss.com', color: 'bg-cyan-500', icon: '🌊' },
  { id: '3', title: 'GitHub - Repos', url: 'github.com', color: 'bg-gray-800', icon: '🐙' },
  { id: '4', title: 'Product Hunt', url: 'producthunt.com', color: 'bg-orange-500', icon: '℗' },
  { id: '5', title: 'Figma Design', url: 'figma.com', color: 'bg-purple-500', icon: '🎨' },
  { id: '6', title: 'TechCrunch', url: 'techcrunch.com', color: 'bg-green-600', icon: '📰' },
  { id: '7', title: 'YouTube', url: 'youtube.com', color: 'bg-red-600', icon: '▶️' },
  { id: '8', title: 'Notion Workspace', url: 'notion.so', color: 'bg-slate-700', icon: '📝' },
];

export const MockBrowser: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.GRID);
  const [themeMode, setThemeMode] = useState<ThemeMode>(ThemeMode.LIGHT);

  const isDark = themeMode === ThemeMode.DARK;

  const toggleView = () => setViewMode(prev => prev === ViewMode.GRID ? ViewMode.LIST : ViewMode.GRID);
  const toggleTheme = () => setThemeMode(prev => prev === ThemeMode.LIGHT ? ThemeMode.DARK : ThemeMode.LIGHT);

  return (
    <div className={`relative w-full max-w-5xl mx-auto rounded-xl overflow-hidden shadow-2xl border ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'} transition-colors duration-300`}>
      {/* Browser Toolbar Mock */}
      <div className={`flex items-center gap-3 px-4 py-3 border-b ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
          <div className="w-3 h-3 rounded-full bg-green-400"></div>
        </div>
        <div className={`flex-1 ml-4 px-3 py-1.5 rounded-md text-sm flex items-center gap-2 ${isDark ? 'bg-slate-900 text-slate-400' : 'bg-white text-slate-500 border border-slate-200'}`}>
          <div className="w-4 h-4"><Globe size={14} /></div>
          <span>chrome://bookmarks</span>
        </div>
      </div>

      {/* Extension UI Header */}
      <div className={`px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 border-b ${isDark ? 'border-slate-800 text-white' : 'border-slate-100 text-slate-900'}`}>
        <div className="flex items-center gap-2 w-full sm:w-auto">
            <h3 className="font-bold text-lg">My Bookmarks</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>124 items</span>
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className={`relative flex-1 sm:w-64 flex items-center px-3 py-2 rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}>
                <Search size={16} className="text-slate-400 mr-2" />
                <input 
                    type="text" 
                    placeholder="Search bookmarks..." 
                    className="bg-transparent border-none outline-none w-full text-sm placeholder:text-slate-400"
                    disabled
                />
            </div>
            <button onClick={toggleView} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-600'}`}>
                {viewMode === ViewMode.GRID ? <List size={20} /> : <Grid size={20} />}
            </button>
            <button onClick={toggleTheme} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-slate-800 text-yellow-400' : 'hover:bg-slate-100 text-slate-600'}`}>
                {isDark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
        </div>
      </div>

      {/* Extension UI Body */}
      <div className="flex h-[500px]">
        {/* Sidebar */}
        <div className={`w-16 sm:w-60 flex-shrink-0 border-r p-4 hidden sm:block ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-100 bg-slate-50'}`}>
            <div className="space-y-1">
                {['All Bookmarks', 'Design Resources', 'Dev Tools', 'Reading List', 'Finance'].map((folder, i) => (
                    <div key={folder} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer ${i === 0 ? (isDark ? 'bg-brand-900/30 text-brand-400' : 'bg-brand-50 text-brand-700') : (isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100')}`}>
                        <Folder size={16} />
                        <span className="font-medium">{folder}</span>
                    </div>
                ))}
            </div>
        </div>

        {/* Content Area */}
        <div className={`flex-1 p-6 overflow-y-auto ${isDark ? 'bg-slate-900' : 'bg-white'}`}>
            <motion.div 
                layout
                className={viewMode === ViewMode.GRID 
                    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" 
                    : "flex flex-col gap-2"
                }
            >
                <AnimatePresence>
                    {MOCK_BOOKMARKS.map((bookmark) => (
                        <BookmarkItem 
                            key={bookmark.id} 
                            data={bookmark} 
                            viewMode={viewMode} 
                            isDark={isDark} 
                        />
                    ))}
                </AnimatePresence>
            </motion.div>
        </div>
      </div>
    </div>
  );
};

const BookmarkItem: React.FC<{ data: BookmarkMock, viewMode: ViewMode, isDark: boolean }> = ({ data, viewMode, isDark }) => {
    if (viewMode === ViewMode.LIST) {
        return (
            <motion.div 
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`group flex items-center justify-between p-3 rounded-lg border transition-all ${isDark ? 'border-slate-800 hover:border-slate-700 hover:bg-slate-800' : 'border-slate-100 hover:border-brand-200 hover:bg-brand-50/30'}`}
            >
                <div className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded flex items-center justify-center text-white text-sm ${data.color}`}>
                        {data.icon}
                    </div>
                    <div>
                        <h4 className={`font-medium text-sm ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>{data.title}</h4>
                        <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{data.url}</p>
                    </div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 flex gap-2">
                    <button className={`p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${isDark ? 'text-slate-400' : 'text-slate-400'}`}><ExternalLink size={14} /></button>
                    <button className={`p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${isDark ? 'text-slate-400' : 'text-slate-400'}`}><MoreVertical size={14} /></button>
                </div>
            </motion.div>
        )
    }

    return (
        <motion.div 
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`group relative rounded-xl overflow-hidden border transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${isDark ? 'border-slate-800 bg-slate-800' : 'border-slate-100 bg-white shadow-sm'}`}
        >
            {/* Thumbnail Mock */}
            <div className={`h-32 w-full ${data.color} opacity-90 flex items-center justify-center`}>
               <span className="text-4xl filter drop-shadow-md">{data.icon}</span>
            </div>
            
            {/* Content */}
            <div className="p-4">
                <div className="flex justify-between items-start mb-1">
                    <h4 className={`font-semibold truncate pr-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>{data.title}</h4>
                    <button className={`opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? 'text-slate-400 hover:text-white' : 'text-slate-400 hover:text-brand-600'}`}>
                        <MoreVertical size={16} />
                    </button>
                </div>
                <p className={`text-xs truncate mb-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{data.url}</p>
                
                <div className="flex gap-2">
                     <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded ${isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>Preview</span>
                </div>
            </div>
        </motion.div>
    );
};