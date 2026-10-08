/**
 * Contenus de formation fournis par PHARMACORP : techniques de vente, accueil, controle des peremptions, bonnes
 * pratiques officinales GENERALES. Aucun conseil therapeutique specifique : chaque officine peut ajouter ses propres
 * contenus (conseils associes, produits complementaires) et TOUT contenu reste en brouillon jusqu'a validation par un
 * pharmacien de l'officine.
 */
export interface SeedItem { kind: 'quiz' | 'tip'; topic: string; title: string; body: string; options?: string[]; answerIndex?: number; explanation?: string }

export const TOPICS: Record<string, string> = {
  peremption: 'Péremptions et délivrance',
  vente: 'Technique de vente',
  panier: 'Panier moyen et conseil associé',
  bonnes_pratiques: 'Bonnes pratiques officinales',
  accueil: 'Accueil et relation client',
  caisse: 'Caisse et rigueur',
};

export const SEED: SeedItem[] = [
  // --- Peremptions ---
  { kind: 'tip', topic: 'peremption', title: 'Toujours regarder la date avant de délivrer', body: 'Avant de remettre une boîte, vérifiez la date de péremption et l’état de l’emballage. Le logiciel bloque les lots périmés, mais seul votre contrôle visuel garantit la boîte que le patient emporte.' },
  { kind: 'quiz', topic: 'peremption', title: 'Date de péremption', body: 'Une boîte indique « EXP 03/2027 ». Jusqu’à quand peut-elle être délivrée ?', options: ['Jusqu’au 1er mars 2027', 'Jusqu’au 31 mars 2027 inclus', 'Jusqu’au 31 décembre 2027', 'Il faut demander au grossiste'], answerIndex: 1, explanation: 'Une date exprimée en mois/année vaut jusqu’au dernier jour du mois indiqué.' },
  { kind: 'quiz', topic: 'peremption', title: 'Ordre de sortie du stock', body: 'Deux lots du même produit sont en rayon : l’un expire en juin, l’autre en décembre. Lequel délivrer en premier ?', options: ['Celui de décembre', 'Celui de juin', 'Le plus accessible', 'Peu importe'], answerIndex: 1, explanation: 'On applique le FEFO : premier périmé, premier sorti. Le logiciel le fait automatiquement à la caisse.' },
  { kind: 'quiz', topic: 'peremption', title: 'Produit périmé trouvé en rayon', body: 'Vous trouvez une boîte périmée en rayon. Que faites-vous ?', options: ['Je la remets au fond du rayon', 'Je la retire, je la signale et elle est enregistrée en mise au rebut', 'Je la vends à prix réduit', 'Je la donne à un client'], answerIndex: 1, explanation: 'Un produit périmé ne doit jamais être délivré : retrait immédiat, signalement au pharmacien et enregistrement de la sortie de stock.' },
  { kind: 'tip', topic: 'peremption', title: 'Rangement à la réception', body: 'À la réception, placez les nouveaux lots DERRIÈRE les plus anciens. Un rayon bien rangé, c’est moins de pertes et moins d’erreurs.' },

  // --- Technique de vente ---
  { kind: 'tip', topic: 'vente', title: 'Écouter avant de proposer', body: 'Posez des questions ouvertes (« Pour qui est-ce ? », « Depuis quand ? ») avant de proposer. Un client écouté revient ; un client à qui l’on vend sans écouter ne revient pas.' },
  { kind: 'quiz', topic: 'vente', title: 'Question ouverte', body: 'Laquelle est une question ouverte ?', options: ['Vous voulez une boîte ?', 'C’est pour vous ?', 'Pouvez-vous me décrire ce que vous ressentez ?', 'Vous payez en espèces ?'], answerIndex: 2, explanation: 'Une question ouverte appelle une réponse développée : elle permet de comprendre le besoin réel.' },
  { kind: 'quiz', topic: 'vente', title: 'Le client hésite sur le prix', body: 'Un client trouve un produit de conseil trop cher. La meilleure réponse ?', options: ['Insister jusqu’à ce qu’il achète', 'Expliquer l’intérêt et, si besoin, proposer une alternative adaptée à son budget', 'Baisser le prix soi-même', 'Lui dire d’aller ailleurs'], answerIndex: 1, explanation: 'On argumente sur le bénéfice et on respecte le budget. Une remise n’est accordée que par une personne autorisée.' },
  { kind: 'tip', topic: 'vente', title: 'Reformuler', body: 'Reformulez le besoin (« Si je comprends bien, vous cherchez… ») : le client se sent compris et vous évitez les erreurs.' },

  // --- Panier et conseil associe ---
  { kind: 'tip', topic: 'panier', title: 'Le conseil associé, un service', body: 'Proposer un produit complémentaire est utile s’il répond à un vrai besoin du client. Pour tout médicament ou toute association, l’avis du pharmacien prime : en cas de doute, demandez-lui.' },
  { kind: 'quiz', topic: 'panier', title: 'Augmenter le panier correctement', body: 'Quelle pratique augmente le panier tout en respectant le client ?', options: ['Ajouter des produits sans demander', 'Proposer un seul complément pertinent en expliquant pourquoi', 'Refuser de vendre sans complément', 'Proposer systématiquement le plus cher'], answerIndex: 1, explanation: 'Un complément pertinent et expliqué rend service ; la vente forcée fait perdre le client.' },
  { kind: 'quiz', topic: 'panier', title: 'Qui valide un conseil sur un médicament ?', body: 'Un client demande si deux médicaments peuvent se prendre ensemble. Que faites-vous ?', options: ['Je réponds selon mon expérience', 'Je demande au pharmacien', 'Je cherche sur Internet', 'Je dis que oui'], answerIndex: 1, explanation: 'Les questions sur les médicaments (associations, posologies, contre-indications) relèvent du pharmacien.' },
  { kind: 'tip', topic: 'panier', title: 'Les conseils de votre officine', body: 'Votre pharmacien peut ajouter ici les associations de conseil validées pour votre officine (ex. produits d’hygiène ou de confort fréquemment demandés ensemble).' },

  // --- Bonnes pratiques officinales ---
  { kind: 'quiz', topic: 'bonnes_pratiques', title: 'Confidentialité', body: 'Un client vient chercher une ordonnance délicate. Comment préserver sa confidentialité ?', options: ['Parler à voix haute pour être clair', 'Parler discrètement et éviter de citer le traitement devant les autres clients', 'Lire l’ordonnance à voix haute', 'Demander aux autres clients de sortir'], answerIndex: 1, explanation: 'Le secret professionnel s’applique à toute l’équipe officinale.' },
  { kind: 'quiz', topic: 'bonnes_pratiques', title: 'Médicament sur ordonnance', body: 'Un client demande un médicament marqué « ordonnance requise » sans ordonnance. Que faites-vous ?', options: ['Je le vends quand même', 'J’en réfère au pharmacien', 'Je donne un autre produit au hasard', 'Je le vends à moitié prix'], answerIndex: 1, explanation: 'La délivrance des médicaments sur prescription relève du pharmacien ; le logiciel l’affiche à la caisse.' },
  { kind: 'tip', topic: 'bonnes_pratiques', title: 'Produits à conserver au froid', body: 'Respectez la chaîne du froid : rangez immédiatement les produits concernés à la réception et vérifiez la température du réfrigérateur selon la procédure de votre officine.' },
  { kind: 'tip', topic: 'bonnes_pratiques', title: 'Traçabilité', body: 'Chaque délivrance est rattachée à un lot. En cas de rappel de lot, l’officine retrouve qui a reçu quoi : ne contournez jamais la saisie en caisse.' },
  { kind: 'quiz', topic: 'bonnes_pratiques', title: 'Hygiène au comptoir', body: 'Quel geste fait partie de l’hygiène de base au comptoir ?', options: ['Se laver ou désinfecter les mains régulièrement', 'Manger au comptoir', 'Poser les boîtes par terre', 'Ouvrir les boîtes pour vérifier'], answerIndex: 0, explanation: 'Les mains propres protègent le patient et l’équipe.' },

  // --- Accueil ---
  { kind: 'tip', topic: 'accueil', title: 'Les 10 premières secondes', body: 'Regardez le client, saluez-le, souriez. Même si vous êtes occupé : « Bonjour, je suis à vous dans un instant. »' },
  { kind: 'quiz', topic: 'accueil', title: 'File d’attente', body: 'Il y a du monde et un client s’impatiente. Que faire ?', options: ['L’ignorer', 'Le saluer, l’informer du temps d’attente et appeler un collègue si possible', 'Servir d’abord ses connaissances', 'Fermer la caisse'], answerIndex: 1, explanation: 'Un client informé patiente mieux ; la file se gère en équipe.' },

  // --- Caisse ---
  { kind: 'quiz', topic: 'caisse', title: 'Paiement Mobile Money', body: 'Un client affirme avoir payé par Mobile Money mais la caisse indique « en attente de confirmation ». Que faites-vous ?', options: ['Je remets la marchandise', 'J’attends la confirmation (ou je vérifie le relevé) avant de remettre', 'J’annule la vente', 'Je demande de payer deux fois'], answerIndex: 1, explanation: 'La marchandise n’est remise qu’après confirmation du paiement.' },
  { kind: 'quiz', topic: 'caisse', title: 'Erreur de caisse', body: 'Vous vous êtes trompé sur une vente. Que faites-vous ?', options: ['Je supprime discrètement', 'Je préviens le responsable qui annule la vente avec un motif', 'Je compense sur la vente suivante', 'Je ne dis rien'], answerIndex: 1, explanation: 'Toute annulation est tracée avec un motif : c’est la transparence qui protège l’équipe.' },
  { kind: 'tip', topic: 'caisse', title: 'Comptage de caisse', body: 'Comptez la caisse à chaque fin de service et saisissez le montant : un écart signalé tôt s’explique facilement.' },
];
