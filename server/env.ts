import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'test' && process.env.INKLOOM_SKIP_AUTOSTART !== 'true') {
  dotenv.config({ quiet: true });
}
