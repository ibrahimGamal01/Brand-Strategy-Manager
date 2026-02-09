import { FieldSchema } from '../types';

export const videoSchema: FieldSchema[] = [
  { 
    key: 'image', 
    label: 'Thumbnail', 
    type: 'image', 
    editable: false 
  },
  { 
    key: 'title', 
    label: 'Title', 
    type: 'text', 
    editable: true,
    required: true
  },
  { 
    key: 'content', 
    label: 'Source URL', 
    type: 'url', 
    editable: true,
    required: true
  },
  { 
    key: 'duration', 
    label: 'Duration', 
    type: 'text', 
    editable: true 
  },
  { 
    key: 'publisher', 
    label: 'Publisher', 
    type: 'text', 
    editable: true 
  },
  { 
    key: 'views', 
    label: 'Views', 
    type: 'number', 
    editable: true 
  }
];
