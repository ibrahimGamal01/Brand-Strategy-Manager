import { FieldSchema } from '../types';

export const communityInsightsSchema: FieldSchema[] = [
  { 
    key: 'content', 
    label: 'Content', 
    type: 'textarea', 
    editable: true,
    required: true
  },
  { 
    key: 'platform', 
    label: 'Platform', 
    type: 'text', 
    editable: true 
  },
  { 
    key: 'sourceUrl', 
    label: 'Source URL', 
    type: 'url', 
    editable: true 
  },
  { 
    key: 'author', 
    label: 'Author', 
    type: 'text', 
    editable: true 
  },
  { 
    key: 'sentiment', 
    label: 'Sentiment', 
    type: 'text', 
    editable: true 
  },
  { 
    key: 'engagement', 
    label: 'Engagement', 
    type: 'number', 
    editable: true 
  },
  { 
    key: 'relevanceScore', 
    label: 'Relevance', 
    type: 'number', 
    editable: true 
  }
];
