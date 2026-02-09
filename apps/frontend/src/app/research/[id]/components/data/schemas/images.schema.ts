import { FieldSchema } from '../types';

export const imageSchema: FieldSchema[] = [
  { 
    key: 'image', 
    label: 'Preview', 
    type: 'image', 
    editable: false 
  },
  { 
    key: 'title', 
    label: 'Title', 
    type: 'text', 
    editable: true 
  },
  { 
    key: 'source', 
    label: 'Source', 
    type: 'text', 
    editable: true 
  },
  { 
    key: 'url', 
    label: 'Source URL', 
    type: 'url', 
    editable: true 
  },
  { 
    key: 'height', 
    label: 'Height', 
    type: 'number', 
    editable: false 
  },
  { 
    key: 'width', 
    label: 'Width', 
    type: 'number', 
    editable: false 
  }
];
