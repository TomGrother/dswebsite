/**
 * The DesignForce reference a form carries in its hidden df_ref field, filled
 * by DesignForce's tracking script (DesignForce docs/website-tracking.md):
 *   DFREF-<id>                           a visitor from one of our emails
 *   DFSRC-<source>.<medium>.<campaign>   a visitor from a tagged post, advert
 *                                        or QR code (each part [a-z0-9_-], up
 *                                        to 30; source or medium is always set)
 * Anything else is dropped, so a form never passes on a value DesignForce
 * would refuse (it refuses a df_ref over 100 characters).
 */
const DFREF = /^DFREF-[A-Za-z0-9_-]{1,64}$/;
const DFSRC = /^DFSRC-([a-z0-9_-]{0,30})\.([a-z0-9_-]{0,30})\.([a-z0-9_-]{0,30})$/;

function cleanDfRef(value) {
  const s = String(value == null ? "" : value).trim();
  if (DFREF.test(s)) return s;
  const m = DFSRC.exec(s);
  return m && (m[1] || m[2]) ? s : "";
}

module.exports = { cleanDfRef };
