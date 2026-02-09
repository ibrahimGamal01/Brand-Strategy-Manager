import { FieldSchema } from '../types';

export const searchResultSchema: FieldSchema[] = [
  { 
    key: 'title', 
    label: 'Title', 
    type: 'text', 
    editable: true,
    required: true
  },
  { 
    key: 'href', 
    label: 'URL', 
    type: 'url', 
    editable: true,
    required: true
  },
  { 
    key: 'body', 
    label: 'Description', 
    type: 'textarea', 
    editable: true 
  },
  { 
    key: 'source', 
    label: 'Source', 
    type: 'text', 
    editable: false 
  },
  { 
    key: 'firstSeenAt', 
    label: 'First Seen', 
    type: 'date', 
    editable: false 
  }
];
