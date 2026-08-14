const { withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const DOSSIER_SOURCE = 'native/app-intents';

/**
 * Recopie les App Intents dans la cible de l'app et les ajoute à sa phase de
 * compilation.
 *
 * Ils ne peuvent pas rester dans le module Expo local : la découverte des
 * intents passe par une extraction de métadonnées à la compilation, qui ne
 * regarde pas les sources d'un pod. Un intent invisible ne lève aucune erreur,
 * il n'existe simplement pas pour Siri, d'où ce détour.
 */
module.exports = function withAppIntents(config) {
  return withXcodeProject(config, (configuration) => {
    const projet = configuration.modResults;
    const racine = configuration.modRequest.projectRoot;
    const dossierNatif = configuration.modRequest.platformProjectRoot;
    const nomApp = configuration.modRequest.projectName;

    if (!nomApp) {
      throw new Error('with-app-intents : nom de projet iOS introuvable');
    }

    const source = path.join(racine, DOSSIER_SOURCE);
    if (!fs.existsSync(source)) {
      throw new Error(`with-app-intents : dossier absent (${DOSSIER_SOURCE})`);
    }

    const cible = path.join(dossierNatif, nomApp);
    fs.mkdirSync(cible, { recursive: true });

    const fichiers = fs.readdirSync(source).filter((f) => f.endsWith('.swift'));
    if (fichiers.length === 0) {
      throw new Error(`with-app-intents : aucun fichier Swift dans ${DOSSIER_SOURCE}`);
    }

    const groupe = projet.findPBXGroupKey({ name: nomApp });
    const cibleApp = projet.getFirstTarget().uuid;

    for (const fichier of fichiers) {
      fs.copyFileSync(path.join(source, fichier), path.join(cible, fichier));
      const chemin = `${nomApp}/${fichier}`;
      if (!projet.hasFile(chemin)) {
        projet.addSourceFile(chemin, { target: cibleApp }, groupe);
      }
    }

    return configuration;
  });
};
