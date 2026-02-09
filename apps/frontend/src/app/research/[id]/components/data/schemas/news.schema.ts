import { FieldSchema } from '../types';

export const newsSchema: FieldSchema[] = [
  { 
    key: 'title', 
    label: 'Title', 
    type: 'text', 
    editable: true,
    required: true
  },
  { 
    key: 'url', 
    label: 'URL', 
    type: 'url', 
    editable: true,
    required: true
  },
  { 
    key: 'excerpt', 
    label: 'Excerpt', 
    type: 'textarea', 
    editable: true 
  },
  { 
    key: 'source', 
    label: 'Source', 
    type: 'text', 
    editable: true 
  },
  { 
    key: 'date', 
    label: 'Published Date', 
    type: 'date', 
    editable: true,
    // Handle timestamp string to date format
    render: (value: any) => {
      // If value is a string timestamp (e.g. "1710928000"), convert to milliseconds
      const date = !isNaN(Number(value)) && Number(value) > 1000000000 
        ? new Date(Number(value) * 1000) 
        : new Date(value);
      return date.toLocaleDateString();
    }
  }
];
