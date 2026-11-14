import crypto from 'crypto';
import { factObservations, evidence as evidenceTable } from '../db/schema.js';

/**
 * Change Detector:
 * Compares past fact observations with fresh search evidence.
 * Tracks pricing shifts, new/discontinued plans, feature changes.
 */
export class ChangeDetector {
  constructor(db) {
    this.db = db;
  }

  /**
   * Analyze new findings against historical observations for matched entities
   *
   * @param {Array<Object>} newFindings - Array of { entityId, claim, value, currency, billingInterval, factType, sourceEvidence }
   * @param {Array<Object>} historicalObservations - Previously recorded observations
   * @param {string} messageId - Associated assistant/user message
   * @returns {Array<Object>} - Analyzed change reports
   */
  async detectAndRecordChanges(newFindings, historicalObservations, messageId = null) {
    const reports = [];
    const nowIso = new Date().toISOString();

    for (const finding of newFindings) {
      const {
        entityId,
        entityName,
        claim,
        value,
        currency = 'USD',
        billingInterval = 'monthly',
        factType = 'general',
        sourceEvidence,
      } = finding;

      // Find matching historical observation for the same entity and equivalent claim/plan
      const matchingHistorical = findEquivalentHistorical(finding, historicalObservations);

      let status = 'insufficient_evidence';
      let changeType = 'unverified';
      let changeSummary = '';

      // Check for explicit insufficient evidence finding
      if (finding.explicitStatus === 'insufficient_evidence') {
        status = 'insufficient_evidence';
        changeType = 'unverified';
        changeSummary = `Web research retrieved sources for ${entityName || 'entity'}, but evidence was insufficient to verify current pricing.`;
      } else if (!matchingHistorical) {
        // No prior record exists
        status = 'historical_unavailable';
        changeType = 'new_plan';
        changeSummary = `First recorded observation for ${entityName || 'entity'}: "${claim}" = ${value}`;
      } else {
        // Compare values
        const comparison = compareValues(
          matchingHistorical.value,
          value,
          factType,
          matchingHistorical.currency,
          currency,
          matchingHistorical.billingInterval,
          billingInterval
        );

        status = comparison.status;
        changeType = comparison.changeType;
        changeSummary = comparison.summary;
      }

      // Persist the new observation without overwriting historical ones
      const observationId = crypto.randomUUID();
      try {
        if (this.db) {
          this.db.insert(factObservations).values({
            id: observationId,
            entityId,
            messageId,
            evidenceId: sourceEvidence ? sourceEvidence.id : null,
            factType,
            claim,
            value,
            currency,
            billingInterval,
            changeType,
            observedAt: nowIso,
            confidence: sourceEvidence ? 0.95 : 0.7,
            status,
          }).run();
        }
      } catch (err) {
        console.warn('Failed to insert fact observation:', err.message);
      }

      reports.push({
        id: observationId,
        entityId,
        entityName: entityName || 'Entity',
        claim,
        previousValue: matchingHistorical ? matchingHistorical.value : null,
        currentValue: value,
        previousObservedAt: matchingHistorical ? matchingHistorical.observedAt : null,
        currentObservedAt: nowIso,
        status,
        changeType,
        summary: changeSummary,
        sourceUrl: sourceEvidence?.url,
        sourceTitle: sourceEvidence?.title,
      });
    }

    return reports;
  }
}

/**
 * Match a new finding with the most relevant historical observation
 */
export function findEquivalentHistorical(finding, historicalObservations = []) {
  if (!historicalObservations || historicalObservations.length === 0) return null;

  const findingClaimNorm = normalizeClaim(finding.claim);

  // Exact claim match for the same entity
  for (const obs of historicalObservations) {
    if (obs.entityId === finding.entityId) {
      if (normalizeClaim(obs.claim) === findingClaimNorm) {
        return obs;
      }
    }
  }

  // Partial/Fuzzy match for plan or tier (e.g. "Pro plan", "Team tier")
  for (const obs of historicalObservations) {
    if (obs.entityId === finding.entityId) {
      const obsClaimNorm = normalizeClaim(obs.claim);
      if (
        (findingClaimNorm.includes('pro') && obsClaimNorm.includes('pro')) ||
        (findingClaimNorm.includes('team') && obsClaimNorm.includes('team')) ||
        (findingClaimNorm.includes('free') && obsClaimNorm.includes('free')) ||
        (findingClaimNorm.includes('starter') && obsClaimNorm.includes('starter')) ||
        (findingClaimNorm.includes('enterprise') && obsClaimNorm.includes('enterprise'))
      ) {
        return obs;
      }
    }
  }

  // 3. Match any existing observation for the same entity if both relate to pricing
  for (const obs of historicalObservations) {
    if (obs.entityId === finding.entityId && (obs.factType === finding.factType || obs.factType === 'pricing')) {
      return obs;
    }
  }

  return null;
}

function normalizeClaim(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
}

/**
 * Compare two values (numerical prices or feature descriptions)
 */
export function compareValues(
  oldVal,
  newVal,
  factType,
  oldCurrency = 'USD',
  newCurrency = 'USD',
  oldInterval = 'monthly',
  newInterval = 'monthly'
) {
  // If currency or billing interval differ, flag model change
  if (oldCurrency !== newCurrency || oldInterval !== newInterval) {
    return {
      status: 'confirmed_change',
      changeType: 'model_change',
      summary: `Pricing structure changed from ${oldCurrency}/${oldInterval} to ${newCurrency}/${newInterval}`,
    };
  }

  // Numerical pricing comparison
  const oldPrice = extractPriceNumber(oldVal);
  const newPrice = extractPriceNumber(newVal);

  if (oldPrice !== null && newPrice !== null) {
    if (newPrice > oldPrice) {
      return {
        status: 'confirmed_change',
        changeType: 'increase',
        summary: `Price increased from ${oldCurrency} ${oldPrice} to ${newCurrency} ${newPrice}`,
      };
    } else if (newPrice < oldPrice) {
      return {
        status: 'confirmed_change',
        changeType: 'decrease',
        summary: `Price decreased from ${oldCurrency} ${oldPrice} to ${newCurrency} ${newPrice}`,
      };
    } else {
      return {
        status: 'no_change',
        changeType: 'no_change',
        summary: `Price unchanged at ${newCurrency} ${newPrice}`,
      };
    }
  }

  // Text/feature comparison
  const cleanOld = oldVal.trim().toLowerCase();
  const cleanNew = newVal.trim().toLowerCase();

  if (cleanOld === cleanNew) {
    return {
      status: 'no_change',
      changeType: 'no_change',
      summary: 'No change detected in specifications',
    };
  }

  // Check for feature addition or removal
  if (cleanNew.includes('discontinued') || cleanNew.includes('deprecated') || cleanNew.includes('removed')) {
    return {
      status: 'confirmed_change',
      changeType: 'feature_removal',
      summary: `Feature or plan removed/deprecated: ${newVal}`,
    };
  }

  if (cleanNew.includes('new') || cleanNew.includes('added') || cleanNew.includes('now supports')) {
    return {
      status: 'confirmed_change',
      changeType: 'feature_addition',
      summary: `New capability or feature added: ${newVal}`,
    };
  }

  return {
    status: 'confirmed_change',
    changeType: 'feature_addition',
    summary: `Updated from "${oldVal}" to "${newVal}"`,
  };
}

/**
 * Parse numeric price from string like "$25/mo", "29 USD", "$0"
 */
export function extractPriceNumber(val) {
  if (typeof val === 'number') return val;
  if (!val || typeof val !== 'string') return null;

  const match = val.match(/(?:\$|£|€)?\s*([0-9]+(?:\.[0-9]+)?)/);
  if (match && match[1]) {
    const num = parseFloat(match[1]);
    return isNaN(num) ? null : num;
  }
  return null;
}
