import { FieldSchema } from '../types';

export const trendsSchema: FieldSchema[] = [
  {
    key: 'keyword',
    label: 'Keyword',
    type: 'text',
    editable: true,
    required: true
  },
  {
    key: 'region',
    label: 'Region',
    type: 'text',
    editable: true
  },
  {
    key: 'timeframe',
    label: 'Timeframe',
    type: 'text',
    editable: true
  },
  {
    key: 'relatedQueries',
    label: 'Related Queries',
    type: 'textarea',
    editable: false,
    render: (value: any) => {
      if (!value) return 'No related queries';
      if (Array.isArray(value)) {
        return value.slice(0, 3).join(', ') || 'No related queries';
      }
      if (typeof value === 'object') {
        const top = Array.isArray(value.top) ? value.top.slice(0, 2) : [];
        const rising = Array.isArray(value.rising) ? value.rising.slice(0, 2) : [];
        const merged = [...top, ...rising]
          .map((entry) => (typeof entry === 'string' ? entry : entry?.query))
          .filter(Boolean);
        return merged.length > 0 ? merged.join(', ') : 'No related queries';
      }
      return String(value);
    }
  },
  {
    key: 'interestOverTime',
    label: 'Interest Over Time',
    type: 'textarea',
    editable: false,
    render: (value: any) => {
      if (!value) return 'No timeline data';
      const timeline = Array.isArray(value)
        ? value
        : Array.isArray(value.default?.timelineData)
          ? value.default.timelineData
          : [];
      if (!timeline.length) return 'No timeline data';

      const latest = timeline[timeline.length - 1];
      const lastValue = Array.isArray(latest?.value) ? latest.value[0] : latest?.value;
      return `Latest interest: ${lastValue ?? 'n/a'} (${timeline.length} points)`;
    }
  }
];
