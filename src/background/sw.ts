// Chrome service worker - imports shared tokenizer host
import { installMessageHandler } from './tokenizer-host';

installMessageHandler();
