export const RULES_ACCEPTANCE_TARGET = Object.freeze({
  guildId: "1565048205970767992",
  applicationId: "1565304619838742598",
  channelId: "1566060632384602132",
  messageId: "1566161923404341290",
  vaultChannelId: "1570614206926033077",
  customId: "dcp:rules:accept:v1"
});

export const RULES_ACCEPTANCE_VERSION = "momentum-movement-rules-2026-11-14";

const noMentions = Object.freeze({ parse: [] });

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function addRulesAcceptanceButton(components) {
  if (!Array.isArray(components)) throw new TypeError("Rules message components must be an array");
  const next = clone(components);
  const container = next.find(component => component?.type === 17 && Array.isArray(component.components));
  if (!container) throw new Error("Expected the existing rules dashboard container was not found");

  const alreadyPresent = container.components.some(component =>
    component?.type === 1 &&
    Array.isArray(component.components) &&
    component.components.some(button => button?.type === 2 && button.custom_id === RULES_ACCEPTANCE_TARGET.customId)
  );
  if (alreadyPresent) return { components: next, changed: false };

  container.components.push(
    { type: 14, divider: true, spacing: 1 },
    {
      type: 10,
      content: "### ✅ Rules Acknowledgement\nSelect **I Agree — Accept Rules** to record that you have read and agree to these community guidelines. This records acceptance for your Discord account; it does not change roles or channel access."
    },
    {
      type: 1,
      components: [{
        type: 2,
        style: 3,
        label: "I Agree — Accept Rules",
        custom_id: RULES_ACCEPTANCE_TARGET.customId
      }]
    }
  );
  return { components: next, changed: true };
}

export function applyRulesAcceptance(record, acceptedAt = new Date()) {
  if (!record || typeof record !== "object" || typeof record.userId !== "string" || !record.userId) {
    throw new TypeError("A persisted member record with userId is required");
  }
  const timestamp = new Date(acceptedAt).toISOString();
  const prior = record.rulesAcceptance && typeof record.rulesAcceptance === "object"
    ? record.rulesAcceptance
    : {};
  const current = prior.current && typeof prior.current === "object" ? prior.current : null;

  if (current?.version === RULES_ACCEPTANCE_VERSION && typeof current.acceptedAt === "string") {
    return { record, changed: false, acceptedAt: current.acceptedAt };
  }

  const history = Array.isArray(prior.history) ? prior.history.filter(item =>
    item && typeof item === "object" && typeof item.version === "string" && typeof item.acceptedAt === "string"
  ) : [];
  if (current?.version && typeof current.acceptedAt === "string") history.unshift(current);

  const acceptance = {
    current: {
      version: RULES_ACCEPTANCE_VERSION,
      acceptedAt: timestamp,
      guildId: RULES_ACCEPTANCE_TARGET.guildId,
      channelId: RULES_ACCEPTANCE_TARGET.channelId,
      messageId: RULES_ACCEPTANCE_TARGET.messageId
    },
    history: history.slice(0, 10)
  };
  return {
    record: { ...record, rulesAcceptance: acceptance },
    changed: true,
    acceptedAt: timestamp
  };
}

export function isRulesAcceptanceInteraction(interaction) {
  return Boolean(
    interaction &&
    typeof interaction.isButton === "function" &&
    interaction.isButton() === true &&
    interaction.applicationId === RULES_ACCEPTANCE_TARGET.applicationId &&
    interaction.guildId === RULES_ACCEPTANCE_TARGET.guildId &&
    interaction.channelId === RULES_ACCEPTANCE_TARGET.channelId &&
    interaction.message?.id === RULES_ACCEPTANCE_TARGET.messageId &&
    interaction.message?.author?.id === RULES_ACCEPTANCE_TARGET.applicationId &&
    interaction.customId === RULES_ACCEPTANCE_TARGET.customId &&
    typeof interaction.user?.id === "string" &&
    interaction.user.id.length > 0
  );
}

export function createRulesAcceptanceHandler({
  getMemberRecord,
  saveMemberRecord,
  notifyMember = async (user, content) => user.send({ content, allowedMentions: noMentions }),
  clock = () => new Date()
} = {}) {
  if (typeof getMemberRecord !== "function" || typeof saveMemberRecord !== "function") {
    throw new TypeError("getMemberRecord and saveMemberRecord functions are required");
  }
  if (typeof notifyMember !== "function" || typeof clock !== "function") {
    throw new TypeError("notifyMember and clock must be functions");
  }

  return async function handleRulesAcceptance(interaction) {
    if (!isRulesAcceptanceInteraction(interaction)) return false;

    await interaction.deferUpdate();
    const userId = interaction.user.id;
    let acceptance;
    try {
      const existing = await getMemberRecord(userId);
      if (!existing || existing.userId !== userId) {
        throw new Error("Member vault returned a mismatched record");
      }
      acceptance = applyRulesAcceptance(existing, clock());
      if (acceptance.changed) await saveMemberRecord(acceptance.record);
    } catch (error) {
      try {
        await notifyMember(
          interaction.user,
          "Momentum Movement could not verify and save your rules acceptance. Please contact the Help Desk; your acceptance has not been recorded."
        );
      } catch {}
      return { handled: true, persisted: false, changed: false, error };
    }

    let notified = false;
    if (acceptance.changed) {
      try {
        await notifyMember(
          interaction.user,
          "✅ Your Momentum Movement rules acceptance was recorded.\nRules version: " +
            RULES_ACCEPTANCE_VERSION +
            "\nAccepted: " + acceptance.acceptedAt +
            "\nNo roles or channel permissions were changed."
        );
        notified = true;
      } catch {}
    }

    return {
      handled: true,
      persisted: true,
      changed: acceptance.changed,
      acceptedAt: acceptance.acceptedAt,
      notified
    };
  };
}
