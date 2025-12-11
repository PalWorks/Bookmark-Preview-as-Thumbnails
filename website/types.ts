import { LucideIcon } from 'lucide-react';

export interface FeatureItem {
  title: string;
  description: string;
  icon: LucideIcon;
}

export interface BookmarkMock {
  id: string;
  title: string;
  url: string;
  color: string;
  icon?: string;
}

export enum ViewMode {
  GRID = 'grid',
  LIST = 'list',
}

export enum ThemeMode {
  LIGHT = 'light',
  DARK = 'dark',
}