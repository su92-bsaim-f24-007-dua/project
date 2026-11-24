import os
import secrets
from datetime import datetime
from flask import Flask, flash, redirect, render_template, request, session, url_for
from models import (
    AuditLog,
    CapacitySnapshot,
    EntryGate,
    Event,
    EventTemplate,
    SavedReport,
    Ticket,
    TicketScan,
    db,
)


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SESSION_SECRET") or secrets.token_hex(32)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///../data/cadence_events.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)

    @app.route("/")
    def index():
        events = Event.query.order_by(Event.start_at.asc()).all()
        return render_template("index.html", events=events)

    @app.route("/events/<int:event_id>")
    def event_detail(event_id: int):
        event = Event.query.get_or_404(event_id)
        return render_template("event_detail.html", event=event)

    @app.route("/templates")
    def templates_catalog():
        templates = EventTemplate.query.order_by(EventTemplate.code.asc()).all()
        return render_template("templates.html", templates=templates)

    @app.route("/scanner", methods=["GET", "POST"])
    def scanner_console():
        if request.method == "POST":
            ticket_code = (request.form.get("ticket_code") or "").strip().upper()
            gate_id = request.form.get("gate_id", type=int)
            if not ticket_code or not gate_id:
                flash("Both ticket code and entry gate are required.", "error")
                return redirect(url_for("scanner_console"))

            ticket = Ticket.query.filter_by(ticket_code=ticket_code).first()
            if not ticket:
                flash(f"Ticket {ticket_code} was not found.", "error")
                return redirect(url_for("scanner_console"))

            if ticket.status == "checked_in":
                db.session.add(
                    TicketScan(
                        ticket_id=ticket.id,
                        event_id=ticket.event_id,
                        gate_id=gate_id,
                        scan_result="ALREADY_CHECKED_IN",
                        rejection_reason="Duplicate pass scan blocked",
                    )
                )
                db.session.commit()
                flash(f"REJECTED: {ticket_code} already checked in.", "error")
                return redirect(url_for("scanner_console"))

            ticket.status = "checked_in"
            ticket.checked_in_at = datetime.utcnow()
            db.session.add(
                TicketScan(
                    ticket_id=ticket.id,
                    event_id=ticket.event_id,
                    gate_id=gate_id,
                    scan_result="VALID",
                )
            )
            db.session.commit()
            session["last_verified_ticket"] = ticket.ticket_code
            flash(f"ENTRY GRANTED: {ticket.holder_name} ({ticket.ticket_code}).", "success")
            return redirect(url_for("scanner_console"))

        gates = EntryGate.query.all()
        scans = TicketScan.query.order_by(TicketScan.id.desc()).limit(20).all()
        return render_template("scanner.html", gates=gates, scans=scans)

    @app.route("/reports")
    def reports_overview():
        reports = SavedReport.query.all()
        snapshots = CapacitySnapshot.query.order_by(CapacitySnapshot.id.desc()).limit(10).all()
        audits = AuditLog.query.order_by(AuditLog.id.desc()).limit(15).all()
        return render_template("reports.html", reports=reports, snapshots=snapshots, audits=audits)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
