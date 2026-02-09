import { FieldSchema } from '../types';

export const mediaAssetSchema: FieldSchema[] = [
  { 
    key: 'thumbnailUrl', 
    label: 'Preview', 
    type: 'image', 
    editable: false 
  },
  { 
    key: 'type', 
    label: 'Type', 
    type: 'text', 
    editable: false 
  },
  { 
    key: 'sourceUrl', 
    label: 'Source', 
    type: 'url', 
    editable: true 
  },
  { 
    key: 'filePath', 
    label: 'Path', 
    type: 'text', 
    editable: false 
  },
  { 
    key: 'description', 
    label: 'Description', 
    type: 'textarea', 
    editable: true 
  },
  { 
    key: 'size', 
    label: 'Size (bytes)', 
    type: 'number', 
    editable: false 
  }
];
