---
version: alpha
name: "Dribbble Light"
description: "Primary visual anchor uses #ffffff with page background, card surfaces, button text on dark backgrounds. Typography baseline relies on Mona Sans for primary hero headline — large, bold, used for the main value proposition."
colors:
  pure-white: "#ffffff"
  off-white-surface: "#faf9fb"
  dark-charcoal: "#212121"
  deep-ink: "#060318"
  dribbble-pink: "#ea4c89"
  medium-purple-gray: "#655c7a"
  mid-purple: "#524b63"
  navy-black: "#0d0c22"
  light-gray: "#ecebf0"
  muted-lavender: "#beb9ca"
typography:
  hero-heading:
    fontFamily: "Mona Sans"
    fontSize: "52px"
    fontWeight: "600"
    lineHeight: "62.4px"
  body-regular:
    fontFamily: "Mona Sans"
    fontSize: "14px"
    fontWeight: "400"
    lineHeight: "28px"
  label-semibold:
    fontFamily: "Mona Sans"
    fontSize: "13px"
    fontWeight: "600"
    lineHeight: "13px"
  label-medium:
    fontFamily: "Mona Sans"
    fontSize: "12px"
    fontWeight: "500"
    lineHeight: "12px"
  body-large:
    fontFamily: "Mona Sans"
    fontSize: "16px"
    fontWeight: "400"
    lineHeight: "28px"
  body-medium:
    fontFamily: "Mona Sans"
    fontSize: "14px"
    fontWeight: "500"
    lineHeight: "17px"
  micro-bold:
    fontFamily: "Mona Sans"
    fontSize: "9px"
    fontWeight: "800"
    lineHeight: "20px"
  body-semibold:
    fontFamily: "Mona Sans"
    fontSize: "14px"
    fontWeight: "600"
    lineHeight: "17px"
rounded:
  radius-sm: "2px"
  radius-md: "4px"
  radius-lg: "6px"
  radius-xl: "8px"
  radius-2xl: "10px"
  radius-card: "12px"
  radius-section: "16px"
  radius-large-card: "24px"
  radius-pill: "50px"
  radius-full: "10000000px"
spacing:
  spacing-1: "4px"
  spacing-2: "5px"
  spacing-3: "6px"
  spacing-4: "8px"
  spacing-5: "10px"
  spacing-6: "12px"
  spacing-7: "14px"
  spacing-8: "16px"
  spacing-9: "18px"
  spacing-10: "20px"
  spacing-11: "22px"
  spacing-12: "24px"
  spacing-13: "32px"
  spacing-14: "40px"
  spacing-15: "44px"
  spacing-16: "50px"
---

## Overview

Primary visual anchor uses #ffffff with page background, card surfaces, button text on dark backgrounds. Typography baseline relies on Mona Sans for primary hero headline — large, bold, used for the main value proposition.

This system uses a 4px base grid with scale values 4, 8, 12, 16, 24, 32, 40, 48, 64, 72.

**Signature traits:**
- Core token rhythm: Token evidence indicates consistent color, spacing, and radius rhythm across visible UI.

## Colors

The palette uses 10 validated color tokens across 1 theme profile. Semantic roles stay attached to observed usage so generation agents can choose accents without inventing new color meaning.

**Semantic naming:**
- **action-text** maps to `navy-black`: Role "text" is grounded by usage context "Primary text, headings, button backgrounds, icon fills — the dominant foreground color across the entire UI".
- **action-primary** maps to `pure-white`: Role "primary" is grounded by usage context "Page background, card surfaces, button text on dark backgrounds".
- **content-text** maps to `dribbble-pink`: Role "text" is grounded by usage context "Brand accent — used on hero headline emphasis text, checkmark icons, and key interactive highlights".
- **border-border** maps to `muted-lavender`: Role "border" is grounded by usage context "Subtle borders, dividers, and muted icon strokes".

### Primary Brand
- **Pure White** (#ffffff): Page background, card surfaces, button text on dark backgrounds. Role: primary. {authored: rgb(255, 255, 255), space: rgb, alpha: 0}

### Text Scale
- **Dark Charcoal** (#212121): Footer text, secondary headings in dark sections. Role: text. {authored: rgb(33, 33, 33), space: rgb}
- **Deep Ink** (#060318): Secondary text and nav item color, slightly lighter than navy black. Role: text. {authored: rgb(6, 3, 24), space: rgb}
- **Dribbble Pink** (#ea4c89): Brand accent — used on hero headline emphasis text, checkmark icons, and key interactive highlights. Role: text. {authored: rgb(234, 76, 137), space: rgb}
- **Medium Purple Gray** (#655c7a): Tertiary text, footer social links, muted metadata. Role: text. {authored: rgb(101, 92, 122), space: rgb}
- **Mid Purple** (#524b63): Secondary body text, footer links, muted labels. Role: text. {authored: rgb(82, 75, 99), space: rgb}
- **Navy Black** (#0d0c22): Primary text, headings, button backgrounds, icon fills — the dominant foreground color across the entire UI. Role: text. {authored: rgb(13, 12, 34), space: rgb}

### Interactive
- **Light Gray** (#ecebf0): Card borders, input outlines, divider lines. Role: border. {authored: rgb(236, 235, 240), space: rgb}
- **Muted Lavender** (#beb9ca): Subtle borders, dividers, and muted icon strokes. Role: border. {authored: rgb(190, 185, 202), space: rgb}

### Surface & Shadows
- **Off White Surface** (#faf9fb): Alternate section backgrounds, subtle surface fills. Role: background. {authored: rgb(250, 249, 251), space: rgb}

## Typography

Typography uses Mona Sans across extracted hierarchy roles. Keep hierarchy mapped to these token rows before adding decorative type styles.

Uses Mona Sans throughout for a uniform feel. Weight range spans semi-bold, regular, medium, bold. Sizes range from 9px to 52px.

### Font Roles
- **Headline Font**: Mona Sans
- **Body Font**: Mona Sans

### Type Scale Evidence
| Role | Font | Size | Weight | Line Height | Letter Spacing | Stack / Features | Notes |
|------|------|------|--------|-------------|----------------|------------------|-------|
| Primary hero headline — large, bold, used for the main value proposition | Mona Sans | 52px | 600 | 62.4px | normal | Mona Sans, Helvetica Neue, Helvetica, Arial, sans-serif; features: "ss01" | Extracted token |
| Default body text, descriptions, paragraph content | Mona Sans | 14px | 400 | 28px | normal | Mona Sans, Helvetica Neue, Helvetica, Arial, sans-serif; features: "ss01" | Extracted token |
| Navigation labels, button text, tab labels, compact UI labels | Mona Sans | 13px | 600 | 13px | normal | Mona Sans, Helvetica Neue, Helvetica, Arial, sans-serif; features: "ss01" | Extracted token |
| Small labels, badges, metadata chips, secondary UI text | Mona Sans | 12px | 500 | 12px | normal | Mona Sans, Helvetica Neue, Helvetica, Arial, sans-serif; features: "ss01" | Extracted token |
| Larger body text, feature descriptions, nav dropdown content | Mona Sans | 16px | 400 | 28px | normal | Mona Sans, Helvetica Neue, Helvetica, Arial, sans-serif; features: "ss01" | Extracted token |
| Emphasized body text, card titles, list item labels | Mona Sans | 14px | 500 | 17px | normal | Mona Sans, Helvetica Neue, Helvetica, Arial, sans-serif; features: "ss01" | Extracted token |
| Micro labels, badges, status indicators, tag text | Mona Sans | 9px | 800 | 20px | normal | Mona Sans, Helvetica Neue, Helvetica, Arial, sans-serif; features: "ss01" | Extracted token |
| Emphasized links, card author names, action text | Mona Sans | 14px | 600 | 17px | normal | Mona Sans, Helvetica Neue, Helvetica, Arial, sans-serif; features: "ss01" | Extracted token |

## Layout

Responsive system uses 2 breakpoint tier(s): mobile, desktop.

### Responsive Strategy
- **mobile (576-845px)**: Constrain layout for small viewports and prioritize vertical stacking.
- **desktop (Unknown)**: Expand layout density and horizontal composition for wide viewports.

### Spacing System
| Token | Value | Px | Notes |
|------|-------|----|-------|
| spacing-1 | 4px | 4 | Extracted spacing token |
| spacing-2 | 5px | 5 | Extracted spacing token |
| spacing-3 | 6px | 6 | Extracted spacing token |
| spacing-4 | 8px | 8 | Extracted spacing token |
| spacing-5 | 10px | 10 | Extracted spacing token |
| spacing-6 | 12px | 12 | Extracted spacing token |
| spacing-7 | 14px | 14 | Extracted spacing token |
| spacing-8 | 16px | 16 | Extracted spacing token |
| spacing-9 | 18px | 18 | Extracted spacing token |
| spacing-10 | 20px | 20 | Extracted spacing token |
| spacing-11 | 22px | 22 | Extracted spacing token |
| spacing-12 | 24px | 24 | Extracted spacing token |
| spacing-13 | 32px | 32 | Extracted spacing token |
| spacing-14 | 40px | 40 | Extracted spacing token |
| spacing-15 | 44px | 44 | Extracted spacing token |
| spacing-16 | 50px | 50 | Extracted spacing token |
| spacing-17 | 60px | 60 | Extracted spacing token |
| spacing-18 | 72px | 72 | Extracted spacing token |

## Elevation & Depth

Keep depth flat unless validated shadow or interaction evidence appears in the extraction payload. Do not invent shadows beyond this evidence boundary.

### Shadow Evidence
| Shadow Token | Layers | Details |
|--------------|--------|---------|
| shadow-card | 1 | 0px 3px 6px 0px rgba(0, 0, 0, 0.14) |
| shadow-modal | 1 | 0px 15px 50px 0px rgba(27, 32, 50, 0.1) |
| shadow-hero | 1 | 0px 32px 68px 0px rgba(0, 0, 0, 0.3) |
| shadow-bottom-bar | 1 | 0px -6px 40px 0px rgba(0, 0, 0, 0.06) |
| shadow-subtle | 1 | 0px 2px 4px 0px rgba(6, 3, 24, 0.1) |

### Interaction Signals
| Theme | Signal | Evidence |
|-------|--------|----------|
| Light | outline-style | solid |
| Light | outline-color | rgb(13, 12, 34) ; rgb(190, 185, 202) ; rgb(255, 255, 255) |
| Light | outline-width | 3px ; 0px |
| Light | outline-offset | 0px ; -3px |
| Light | transform | matrix(1, 0, 0, 1, 0, 0) ; matrix(1, 0, 0, 1, 1, 0) ; matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -0.00333333, 0, 0, 0, 1) |

## Shapes

Shape language maps directly to rounded tokens. Keep component corners consistent with the role mapping below before introducing bespoke geometry.

### Radius Roles
| Token | Value | Px | Role Mapping |
|------|-------|----|--------------|
| radius-sm | 2px | 2 | Hairline corner |
| radius-md | 4px | 4 | Subtle corner |
| radius-lg | 6px | 6 | Subtle corner |
| radius-xl | 8px | 8 | Control corner |
| radius-2xl | 10px | 10 | Control corner |
| radius-card | 12px | 12 | Control corner |
| radius-section | 16px | 16 | Card corner |
| radius-large-card | 24px | 24 | Large surface corner |
| radius-pill | 50px | 50 | Large surface corner |
| radius-full | 10000000px | 10000000 | Large surface corner |

### Geometry Evidence
| Radius Token | Shape | Units |
|--------------|-------|-------|
| radius-sm | 2px | px |
| radius-md | 4px | px |
| radius-lg | 6px | px |
| radius-xl | 8px | px |
| radius-2xl | 10px | px |
| radius-card | 12px | px |
| radius-section | 16px | px |
| radius-large-card | 24px | px |
| radius-pill | 50px | px |
| radius-full | 1e+07px | px |

## Components

(none detected)

## Do's and Don'ts

Guardrails protect Core token rhythm without adding unsupported visual claims.

| Do | Don't |
|----|---------|
| Do maintain consistent spacing using the base grid | Don't make unsupported claims about absent visual features |
| Do maintain WCAG AA contrast ratios (4.5:1 for normal text) | Don't mix rounded and sharp corners in the same view |
| Do use the primary color only for the single most important action per screen |  |
| Do verify evidence before writing new design-system guidance |  |

## Responsive Evidence

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <= 352px | (max-width: 352px) |
| Mobile | <= 425px | (max-width: 425px) |
| Mobile | <= 440px | (max-width: 440px) |
| Mobile | <= 576px | (max-width: 576px) |
| Breakpoint 5 | <= 768px | (max-width: 768px) |
| Breakpoint 6 | <= 845px | (max-width: 845px) |
| Mobile | >= 576px | (min-width: 576px) and (max-height: 660px) |
| Breakpoint 8 | Unknown | (hover: hover) |

## Agent Prompt Guide

### Example Component Prompts
- Create button component using validated primary color role and spacing tokens.
- Create card component with mapped radius role and evidence-backed elevation.
- Create form input component using inferred typography hierarchy and border roles.

### Iteration Guide
1. Start with extracted palette and typography roles only.
2. Map spacing and radius directly from token tables before visual polish.
3. Apply component patterns one section at a time and compare against source intent.
4. Keep elevation claims tied to explicit evidence in output.
5. Iterate with smallest diffs and re-check section hierarchy after each change.
