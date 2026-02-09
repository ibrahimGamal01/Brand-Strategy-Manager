import { FieldSchema } from '../types';

export const trendsSchema: FieldSchema[] = [
  { 
    key: 'name', 
    label: 'Keyword', 
    type: 'text', 
    editable: true,
    required: true
  },
  { 
    key: 'volume', 
    label: 'Volume', 
    type: 'number', 
    editable: true 
  },
  { 
    key: 'growthRate', 
    label: 'Growth Rate', 
    type: 'text', 
    editable: true 
  },
  { 
    key: 'platform', 
    label: 'Platform', 
    type: 'text', 
    editable: false 
  },
  { 
    key: 'type', 
    label: 'Type', 
    type: 'text', 
    editable: false 
  },
  { 
    key: 'sentiment', 
    label: 'Sentiment', 
    type: 'text', 
    editable: true 
  }
];
