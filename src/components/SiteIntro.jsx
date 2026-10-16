import React from 'react';
import { TERMINALS, terminalPath } from '../utils/terminals';
import { INTRO_HEADING, INTRO_TEXT, TERMINALS_HEADING, CLASSES } from '../utils/seoContent';

// Crawlable intro + terminal links. Mirrors introSectionHtml() in
// utils/seoContent.js, which is the pre-React copy baked into index.html.
const SiteIntro = () => (
  <section className={CLASSES.section} aria-labelledby="site-intro-heading">
    <h1 id="site-intro-heading" className={CLASSES.heading}>{INTRO_HEADING}</h1>
    <p className={CLASSES.text}>{INTRO_TEXT}</p>
    <h2 className={CLASSES.subheading}>{TERMINALS_HEADING}</h2>
    <ul className={CLASSES.list}>
      {TERMINALS.map((t) => (
        <li key={t.id}>
          <a className={CLASSES.link} href={terminalPath(t.slug)}>{t.name}</a>
        </li>
      ))}
    </ul>
  </section>
);

export default SiteIntro;
