import { FieldSchema } from '../types';

export const aiQuestionsSchema: FieldSchema[] = [
  { 
    key: 'questionType', 
    label: 'Type', 
    type: 'text', 
    editable: false 
  },
  { 
    key: 'question', 
    label: 'Question', 
    type: 'text', 
    editable: true,
    required: true
  },
  { 
    key: 'answer', 
    label: 'Answer', 
    type: 'textarea', 
    editable: true 
  },
  { 
    key: 'modelUsed', 
    label: 'Model', 
    type: 'text', 
    editable: false 
  },
  { 
    key: 'tokensUsed', 
    label: 'Tokens', 
    type: 'number', 
    editable: false 
  },
  { 
    key: 'createdAt', 
    label: 'Created', 
    type: 'date', 
    editable: false 
  }
];
