import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/authenticate.js';
import * as controller from './search.controller.js';
import { searchMessagesQuerySchema } from './search.validation.js';

const router = Router();

router.use(authenticate);
router.get('/messages', validate({ query: searchMessagesQuerySchema }), controller.searchMessages);

export default router;