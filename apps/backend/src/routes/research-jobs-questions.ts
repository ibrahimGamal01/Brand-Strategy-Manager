import { Router } from 'express';
import { evaluatePendingQuestionSets, saveQuestionSetAnswers } from '../services/intake/question-workflow';

const router = Router();

router.get('/:id/questions/pending', async (req, res) => {
  try {
    const { id: researchJobId } = req.params;
    const pending = await evaluatePendingQuestionSets(researchJobId);
    return res.json({ pending });
  } catch (error: any) {
    console.error('[Questions] Failed to fetch pending question sets:', error);
    return res.status(500).json({ error: 'Failed to fetch pending question sets', details: error.message });
  }
});

router.post('/:id/questions/answer', async (req, res) => {
  try {
    const { id: researchJobId } = req.params;
    const { setId, answers } = req.body || {};
    if (!setId) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    if (Array.isArray(answers) && answers.length > 0) {
      await saveQuestionSetAnswers({ researchJobId, setId, answers });
    }
    return res.json({ ok: true });
  } catch (error: any) {
    console.error('[Questions] Failed to save answers:', error);
    return res.status(500).json({ error: 'Failed to save answers', details: error.message });
  }
});

export default router;
