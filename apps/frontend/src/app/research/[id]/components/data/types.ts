// Type definitions for field schemas and data cards

export type FieldType = 'text' | 'number' | 'textarea' | 'url' | 'date' | 'image' | 'array' | 'select' | 'boolean';

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  editable?: boolean;
  placeholder?: string;
  required?: boolean;
  validation?: (value: any) => string | null; // Returns error message or null
  options?: string[]; // For select fields
  render?: (value: any, data: any) => React.ReactNode; // Custom renderer
}

export interface Action {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: (data: any) => void;
  variant?: 'default' | 'destructive' | 'outline' | 'ghost';
  show?: (data: any) => boolean; // Conditional display
}

export interface DataCardConfig<T = any> {
  data: T;
  schema: FieldSchema[];
  title?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: Action[];
  onEdit?: (id: string, updates: Partial<T>) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
  defaultExpanded?: boolean;
}
